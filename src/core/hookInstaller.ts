import fsp from 'node:fs/promises';
import path from 'node:path';
import { claudeDir } from './paths.js';
import { DEFAULT_HOOK_PORT, HOOK_PATH } from './hookServer.js';

export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'Notification',
  'PermissionRequest',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
] as const;

export function hookUrl(port: number): string {
  return `http://127.0.0.1:${port}${HOOK_PATH}`;
}

/**
 * command 型 hook：curl 短超时 + `|| true`，app 没开时绝对静默（http 型 hook
 * 的 ECONNREFUSED 会在 Claude Code 里打 warning，实测验证过）。
 */
export function hookCommand(port: number): string {
  return `curl -s -m 2 -X POST -H "Content-Type: application/json" --data-binary @- "${hookUrl(port)}" >/dev/null 2>&1 || true`;
}

interface HookEntry {
  type?: string;
  url?: string;
  [k: string]: unknown;
}
interface MatcherGroup {
  matcher?: string;
  hooks?: HookEntry[];
  [k: string]: unknown;
}

/** 是不是 crabwatch 自己注册的条目（不论端口/类型，靠 URL 路径标记识别） */
function isOurs(group: MatcherGroup): boolean {
  return (
    Array.isArray(group.hooks) &&
    group.hooks.some(
      (h) =>
        (typeof h?.url === 'string' && h.url.includes(HOOK_PATH)) ||
        (typeof h?.command === 'string' && h.command.includes(HOOK_PATH)),
    )
  );
}

export interface InstallPlan {
  settingsPath: string;
  before: string;
  after: string;
  /** 每个事件做了什么：added / replaced / removed / unchanged */
  actions: Record<string, string>;
}

/**
 * 计算（不落盘）对 ~/.claude/settings.json 的修改。
 * 规则：绝不动别人的条目；自己的条目按 HOOK_PATH 识别、幂等替换。
 */
export async function planInstall(
  mode: 'install' | 'uninstall',
  port = DEFAULT_HOOK_PORT,
  settingsPath = path.join(claudeDir, 'settings.json'),
): Promise<InstallPlan> {
  const before = await fsp.readFile(settingsPath, 'utf8');
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(before) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `settings.json 不是合法 JSON，拒绝修改（请手动检查 ${settingsPath}）: ${(err as Error).message}`,
    );
  }
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings))
    throw new Error('settings.json 顶层不是对象，拒绝修改');

  const hooks = (settings.hooks ?? {}) as Record<string, MatcherGroup[]>;
  const actions: Record<string, string> = {};

  for (const event of HOOK_EVENTS) {
    const groups: MatcherGroup[] = Array.isArray(hooks[event])
      ? hooks[event]
      : [];
    const others = groups.filter((g) => !isOurs(g));
    const hadOurs = others.length !== groups.length;
    if (mode === 'uninstall') {
      actions[event] = hadOurs ? 'removed' : 'unchanged';
      if (others.length > 0) hooks[event] = others;
      else if (hadOurs) delete hooks[event];
      continue;
    }
    const entry: MatcherGroup = {
      matcher: '',
      hooks: [{ type: 'command', command: hookCommand(port) }],
    };
    hooks[event] = [...others, entry];
    actions[event] = hadOurs ? 'replaced' : 'added';
  }
  if (Object.keys(hooks).length > 0) settings.hooks = hooks;
  else delete settings.hooks;

  const after = JSON.stringify(settings, null, 2) + '\n';
  return { settingsPath, before, after, actions };
}

/** 落盘：先写带时间戳的备份，再原子替换 */
export async function applyPlan(plan: InstallPlan): Promise<string> {
  const backupPath = `${plan.settingsPath}.bak-${Date.now()}`;
  await fsp.writeFile(backupPath, plan.before, 'utf8');
  const tmp = `${plan.settingsPath}.crabwatch-tmp`;
  await fsp.writeFile(tmp, plan.after, 'utf8');
  await fsp.rename(tmp, plan.settingsPath);
  return backupPath;
}
