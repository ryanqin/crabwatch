import { BrowserWindow, screen } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 略缩悬浮 roster 窗：常驻置顶、无边框、可拖的小窗，每个 session 一行（状态点 + 名 +
 * context%），点行展开主窗并选中。加载同一个 React renderer 但走 `#roster` 分支只渲染
 * MiniRoster；engine 事件由 ipcBridge 广播到它，自带 store 与主窗各自独立同步。
 * 透明窗 + CSS 圆角面板（对齐 questionBubble 的做法），位置/可见性记到 ~/.crabwatch。
 */
const CFG = path.join(os.homedir(), '.crabwatch', 'floating.json');
const W = 232; // 固定宽，高度由内容回传决定

let floating: BrowserWindow | null = null;

interface FloatCfg {
  visible?: boolean;
  x?: number;
  y?: number;
}
function readCfg(): FloatCfg {
  try {
    return JSON.parse(fs.readFileSync(CFG, 'utf8')) as FloatCfg;
  } catch {
    return {};
  }
}
function patchCfg(p: FloatCfg): void {
  try {
    fs.mkdirSync(path.dirname(CFG), { recursive: true });
    fs.writeFileSync(CFG, JSON.stringify({ ...readCfg(), ...p }));
  } catch {
    /* 记不住位置无害 */
  }
}

export function getFloatingWindow(): BrowserWindow | null {
  return floating && !floating.isDestroyed() ? floating : null;
}

export function isFloatingVisible(): boolean {
  return !!getFloatingWindow()?.isVisible();
}

/** 上次退出时是否开着——index.ts 启动时据此决定要不要拉起 */
export function wasFloatingVisible(): boolean {
  return readCfg().visible === true;
}

function ensureWindow(preloadPath: string): BrowserWindow {
  if (floating && !floating.isDestroyed()) return floating;
  const wa = screen.getPrimaryDisplay().workArea;
  const cfg = readCfg();
  const x = cfg.x ?? wa.x + wa.width - W - 18;
  const y = cfg.y ?? wa.y + 60;
  const w = new BrowserWindow({
    width: W,
    height: 120,
    x,
    y,
    minWidth: W,
    maxWidth: W,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: false,
    show: false,
    focusable: true,
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: false },
  });
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void w.loadURL(`${devUrl}#roster`);
  else
    void w.loadFile(path.join(import.meta.dirname, '../renderer/index.html'), {
      hash: 'roster',
    });

  // 拖动后防抖记位置
  let mt: ReturnType<typeof setTimeout> | undefined;
  w.on('move', () => {
    if (!floating || floating.isDestroyed()) return;
    const [bx, by] = floating.getPosition();
    if (mt) clearTimeout(mt);
    mt = setTimeout(() => patchCfg({ x: bx, y: by }), 300);
  });
  w.on('closed', () => {
    floating = null;
  });
  floating = w;
  return w;
}

export function showFloating(preloadPath: string): void {
  const w = ensureWindow(preloadPath);
  patchCfg({ visible: true });
  if (w.isVisible()) {
    w.show();
    return;
  }
  // 首次创建要等内容就绪再显示，避免白闪；已加载过（隐藏后再开）则直接显示
  if (w.webContents.isLoading()) w.once('ready-to-show', () => w.show());
  else w.show();
}

export function hideFloating(): void {
  getFloatingWindow()?.hide();
  patchCfg({ visible: false });
}

export function setFloating(on: boolean, preloadPath: string): boolean {
  if (on) showFloating(preloadPath);
  else hideFloating();
  return isFloatingVisible();
}

/** renderer 量出内容真实高度后调窗口跟随（同 setBubbleHeight 思路），钳在屏幕内 */
export function setFloatingHeight(height: number): void {
  const w = getFloatingWindow();
  if (!w) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const h = Math.min(Math.max(Math.round(height), 44), wa.height - 40);
  const [, cur] = w.getSize();
  if (Math.abs(cur - h) > 1) w.setSize(W, h);
}
