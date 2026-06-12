import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { UsageSnapshot } from '../shared/types.js';

const execFileP = promisify(execFile);
const FRESH_MS = 5 * 60_000;
const HUD_CACHE = path.join(
  os.homedir(),
  '.claude/plugins/claude-hud/.usage-cache.json',
);

async function keychainToken(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('security', [
      'find-generic-password',
      '-s',
      'Claude Code-credentials',
      '-w',
    ]);
    const creds = JSON.parse(stdout.trim()) as {
      claudeAiOauth?: { accessToken?: string; subscriptionType?: string };
    };
    return creds.claudeAiOauth?.accessToken;
  } catch {
    return undefined;
  }
}

async function fetchOauthUsage(): Promise<UsageSnapshot | undefined> {
  const token = await keychainToken();
  if (!token) return undefined;
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'crabwatch/0.1.0',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`usage api ${res.status}`);
  const data = (await res.json()) as {
    five_hour?: { utilization?: number; resets_at?: string };
    seven_day?: { utilization?: number; resets_at?: string };
  };
  if (data.five_hour?.utilization === undefined) return undefined;
  return {
    fiveHourPct: Math.round(data.five_hour.utilization ?? 0),
    weeklyPct: Math.round(data.seven_day?.utilization ?? 0),
    fiveHourResetAt: data.five_hour?.resets_at,
    weeklyResetAt: data.seven_day?.resets_at,
    source: 'oauth-api',
    fetchedAt: Date.now(),
  };
}

async function readHudCache(): Promise<UsageSnapshot | undefined> {
  try {
    const raw = JSON.parse(await fsp.readFile(HUD_CACHE, 'utf8')) as {
      data?: {
        planName?: string;
        fiveHour?: number;
        sevenDay?: number;
        fiveHourResetAt?: string;
        sevenDayResetAt?: string;
      };
      timestamp?: number;
    };
    // claude-hud 新版改走 stdin，这个文件可能很旧——只接受 10 分钟内的
    if (!raw.data || !raw.timestamp || Date.now() - raw.timestamp > 10 * 60_000)
      return undefined;
    return {
      fiveHourPct: raw.data.fiveHour ?? 0,
      weeklyPct: raw.data.sevenDay ?? 0,
      fiveHourResetAt: raw.data.fiveHourResetAt,
      weeklyResetAt: raw.data.sevenDayResetAt,
      planName: raw.data.planName,
      source: 'claude-hud-cache',
      fetchedAt: raw.timestamp,
    };
  } catch {
    return undefined;
  }
}

/** OAuth API 为主（claude-hud 新版不再刷缓存文件），hud 缓存兜底，5 分钟自缓存 + 失败退避 */
export class UsageService {
  private last: UsageSnapshot | null = null;
  private backoffUntil = 0;
  private backoffMs = 60_000;

  async get(): Promise<UsageSnapshot | null> {
    const now = Date.now();
    if (this.last && now - this.last.fetchedAt < FRESH_MS) return this.last;
    if (now < this.backoffUntil) return this.last;
    try {
      const snap = await fetchOauthUsage();
      if (snap) {
        this.last = snap;
        this.backoffMs = 60_000;
        return snap;
      }
    } catch {
      this.backoffUntil = now + this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, 300_000);
    }
    const hud = await readHudCache();
    if (hud) this.last = hud;
    return this.last;
  }
}
