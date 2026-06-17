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
const W = 232; // 默认宽（用户可拖宽，记到 cfg.w）；高度始终由内容回传决定
const MIN_W = 200;
const MAX_W = 560;

let floating: BrowserWindow | null = null;

interface FloatCfg {
  visible?: boolean;
  x?: number;
  y?: number;
  w?: number;
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
  const width = Math.min(Math.max(cfg.w ?? W, MIN_W), MAX_W);
  const x = cfg.x ?? wa.x + wa.width - width - 18;
  const y = cfg.y ?? wa.y + 60;
  const w = new BrowserWindow({
    width,
    height: 120,
    x,
    y,
    minWidth: MIN_W,
    maxWidth: MAX_W,
    frame: false,
    // 毛玻璃浮窗：under-window 跟随 nativeTheme 明暗（白天浅/黑夜暗），底色透明让材质透出，系统圆角。
    // 注意：vibrancy 与 transparent:true 冲突，故不再用 transparent。明暗基色由 CSS --mini-bg 叠加定调。
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    roundedCorners: true,
    resizable: true, // 用户可拖宽（高度仍由内容自适应）
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: true, // 磨砂浮窗加投影，更像悬浮玻璃
    show: false,
    focusable: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
      // 常驻不聚焦的窗：关掉后台节流，头部那只蟹才能照常踱步（rAF 不被压到 ~1fps）
      backgroundThrottling: false,
    },
  });
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void w.loadURL(`${devUrl}#roster`);
  else
    void w.loadFile(path.join(import.meta.dirname, '../renderer/index.html'), {
      hash: 'roster',
    });

  // 拖动记位置 / 拖宽记宽度（各自防抖）
  let mt: ReturnType<typeof setTimeout> | undefined;
  w.on('move', () => {
    if (!floating || floating.isDestroyed()) return;
    const [bx, by] = floating.getPosition();
    if (mt) clearTimeout(mt);
    mt = setTimeout(() => patchCfg({ x: bx, y: by }), 300);
  });
  let rt: ReturnType<typeof setTimeout> | undefined;
  w.on('resize', () => {
    if (!floating || floating.isDestroyed()) return;
    const [bw] = floating.getSize();
    if (rt) clearTimeout(rt);
    rt = setTimeout(() => patchCfg({ w: bw }), 300);
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
  const [curW, cur] = w.getSize();
  if (Math.abs(cur - h) > 1) w.setSize(curW, h); // 保持当前宽度，只调高度
}
