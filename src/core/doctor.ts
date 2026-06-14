import fsp from 'node:fs/promises';
import path from 'node:path';
import { claudeDir } from './paths.js';
import { HOOK_EVENTS } from './hookInstaller.js';
import { HOOK_PATH } from './hookServer.js';
import { resolveClaude } from './summarizer.js';

export type CheckStatus = 'pass' | 'warn' | 'critical';

export interface DoctorCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** 可操作建议（一句话） */
  hint?: string;
}

export interface DoctorReport {
  overall: CheckStatus;
  checks: DoctorCheck[];
  at: number;
}

interface HookServerStatus {
  listening: boolean;
  eventCount: number;
  lastEventAt?: number;
  lastByEvent: Record<string, number>;
  interactivePermissions: boolean;
  holdElicitation: boolean;
}

function rel(ts?: number): string {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

interface HookGroup {
  hooks?: { type?: string; url?: string; command?: string }[];
}

function isOursGroup(g: HookGroup): boolean {
  return (
    Array.isArray(g.hooks) &&
    g.hooks.some(
      (h) =>
        (typeof h.url === 'string' && h.url.includes(HOOK_PATH)) ||
        (typeof h.command === 'string' && h.command.includes(HOOK_PATH)),
    )
  );
}

/**
 * 一键自诊断（学 clawd 的 doctor）：把"hook 为什么不工作"这类排查从手动
 * grep/curl 变成可视检查。重点是 §冲突检测——我们踩过 clawd 抢占 Elicitation 的坑。
 */
export async function runDoctor(
  status: HookServerStatus | undefined,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const settingsPath = path.join(claudeDir, 'settings.json');

  // 1. 本地 hook server
  if (!status) {
    checks.push({
      id: 'server',
      label: 'Hook server',
      status: 'critical',
      detail: 'not started (engine running without hook server)',
      hint: 'Restart CrabWatch',
    });
  } else if (!status.listening) {
    checks.push({
      id: 'server',
      label: 'Hook server',
      status: 'critical',
      detail: 'failed to bind port 48761 (another process using it?)',
      hint: 'Quit whatever holds :48761, then restart',
    });
  } else {
    checks.push({
      id: 'server',
      label: 'Hook server',
      status: 'pass',
      detail: `listening on :48761 · ${status.eventCount} events received`,
    });
  }

  // 2. 实证：最近真的在收事件吗
  if (status?.listening) {
    const fresh = status.lastEventAt && Date.now() - status.lastEventAt < 600_000;
    checks.push({
      id: 'activity',
      label: 'Receiving events',
      status: status.eventCount === 0 ? 'warn' : 'pass',
      detail:
        status.eventCount === 0
          ? 'no hook events yet — type in any Claude Code session to test'
          : `last event ${rel(status.lastEventAt)}${fresh ? '' : ' (quiet a while — normal if idle)'}`,
      hint:
        status.eventCount === 0
          ? 'If nothing arrives while a session works, hooks may not be installed'
          : undefined,
    });
  }

  // 3 & 4. 读 settings.json：安装完整性 + 冲突检测
  let settings: Record<string, unknown> | undefined;
  try {
    settings = JSON.parse(await fsp.readFile(settingsPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch (err) {
    checks.push({
      id: 'hooks',
      label: 'Hooks installed',
      status: 'critical',
      detail: `can't read settings.json: ${(err as Error).message}`,
      hint: 'Reinstall hooks',
    });
  }

  if (settings) {
    const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
    const missing = HOOK_EVENTS.filter(
      (ev) => !(hooks[ev] ?? []).some(isOursGroup),
    );
    checks.push({
      id: 'hooks',
      label: 'Hooks installed',
      status: missing.length === 0 ? 'pass' : missing.length > 4 ? 'critical' : 'warn',
      detail:
        missing.length === 0
          ? `all ${HOOK_EVENTS.length} hook events registered`
          : `missing ${missing.length}: ${missing.join(', ')}`,
      hint: missing.length > 0 ? 'Reinstall hooks to add them' : undefined,
    });

    // 冲突检测：同一事件上有别的工具 hook（clawd 等）——可能抢占。
    // 特别标记 PermissionRequest / Elicitation：抢占会让我们的气泡收不到。
    const conflicts: string[] = [];
    const criticalConflict: string[] = [];
    for (const ev of HOOK_EVENTS) {
      const groups = hooks[ev] ?? [];
      const others = groups.filter((g) => !isOursGroup(g));
      if (others.length > 0) {
        conflicts.push(ev);
        if (ev === 'PermissionRequest' || ev === 'Elicitation')
          criticalConflict.push(ev);
      }
    }
    if (conflicts.length === 0) {
      checks.push({
        id: 'conflicts',
        label: 'Hook conflicts',
        status: 'pass',
        detail: 'no other tools registered on the same hooks',
      });
    } else {
      checks.push({
        id: 'conflicts',
        label: 'Hook conflicts',
        status: criticalConflict.length > 0 ? 'warn' : 'pass',
        detail:
          `another tool (e.g. clawd-on-desk) also hooks: ${conflicts.join(', ')}` +
          (criticalConflict.length
            ? ` — on ${criticalConflict.join('/')} it may win the race and our bubbles won't show`
            : ''),
        hint: criticalConflict.length
          ? 'Disable that tool to let CrabWatch handle prompts'
          : undefined,
      });
    }
  }

  // 5. claude CLI（summarizer / story 依赖）
  try {
    const bin = await resolveClaude();
    const found = bin !== 'claude';
    checks.push({
      id: 'claude',
      label: 'Claude CLI',
      status: found ? 'pass' : 'warn',
      detail: found ? bin : 'not found on common paths — falling back to bare "claude"',
      hint: found ? undefined : 'Explain / Story need the claude CLI on PATH',
    });
  } catch {
    checks.push({
      id: 'claude',
      label: 'Claude CLI',
      status: 'warn',
      detail: 'resolution failed',
    });
  }

  const overall: CheckStatus = checks.some((c) => c.status === 'critical')
    ? 'critical'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';
  return { overall, checks, at: Date.now() };
}
