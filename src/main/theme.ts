import { nativeTheme, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 白天/黑夜主题。偏好 = system|light|dark（持久化到 ~/.crabwatch/theme.json）。
 * 偏好喂给 `nativeTheme.themeSource` → 驱动原生 vibrancy 的明暗（under-window 自动跟随）；
 * 解析后的明暗（resolved）广播给各 renderer，由它们给 <html> 切 theme-dark/theme-light。
 */
export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const CFG = path.join(os.homedir(), '.crabwatch', 'theme.json');

export function readThemePref(): ThemePref {
  try {
    const v = (JSON.parse(fs.readFileSync(CFG, 'utf8')) as { pref?: ThemePref })
      .pref;
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* 没存过 → 默认跟随系统 */
  }
  return 'system';
}

function writeThemePref(pref: ThemePref): void {
  try {
    fs.mkdirSync(path.dirname(CFG), { recursive: true });
    fs.writeFileSync(CFG, JSON.stringify({ pref }));
  } catch {
    /* 记不住偏好无害 */
  }
}

export function resolvedTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/** 启动时把存的偏好喂给 nativeTheme（决定原生外观/vibrancy 明暗） */
export function applyStoredThemePref(): void {
  nativeTheme.themeSource = readThemePref();
}

/** 设置偏好：持久化 + 应用到 nativeTheme，返回解析后的明暗 */
export function setThemePref(pref: ThemePref): ResolvedTheme {
  writeThemePref(pref);
  nativeTheme.themeSource = pref;
  return resolvedTheme();
}

/** 把当前 resolved 主题广播给给定窗口（renderer 据此切 <html> class） */
export function broadcastTheme(windows: (BrowserWindow | null)[]): void {
  const t = resolvedTheme();
  for (const w of windows) {
    if (w && !w.isDestroyed()) w.webContents.send('cw:theme', t);
  }
}
