import { BrowserWindow, screen, nativeTheme } from 'electron';

/**
 * 屏幕角落的像素风通知浮窗（学 clawd-on-desk 的 bubble）：置顶、不抢焦点（showInactive）。
 * **可拖动**（整窗 app-region drag + movable）+ **可手动关**（右上角 ×）+ **8s 自动消失**
 * （hover/拖动时暂停倒计时，移开再续，避免你正要点它时消失）。单窗复用：新通知替换内容、
 * 重置倒计时；位置一旦被你拖动就保留（只在首次创建时定位）。颜色跟随白天/黑夜主题。
 */
let win: BrowserWindow | null = null;
let onClickCb: (() => void) | null = null;
let hideTimer: NodeJS.Timeout | undefined;
const AUTO_HIDE_MS = 8000;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function armHide(): void {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => win?.hide(), AUTO_HIDE_MS);
}

/** 跟随系统明暗的配色 */
function palette() {
  return nativeTheme.shouldUseDarkColors
    ? {
        bg: '#171b20',
        border: '#c79a4e',
        title: '#c79a4e',
        body: '#a4abb5',
        x: '#6e7681',
        xHover: '#d6d9de',
      }
    : {
        bg: '#f4f6f9',
        border: '#9a6a1e',
        title: '#9a6a1e',
        body: '#5b6471',
        x: '#8a93a0',
        xHover: '#1b1f27',
      };
}

export function showPopup(title: string, body: string, onClick: () => void) {
  const W = 300;
  const H = 66;
  onClickCb = onClick; // 复用窗时也用最新的回调
  if (!win || win.isDestroyed()) {
    const wa = screen.getPrimaryDisplay().workArea;
    win = new BrowserWindow({
      width: W,
      height: H,
      x: wa.x + wa.width - W - 14,
      y: wa.y + 14,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true, // 可拖（配 body 的 -webkit-app-region: drag）
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true, // 允许拖动/点击；仍用 showInactive，出现时不抢焦点
      show: false,
      hasShadow: false,
    });
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // 无 preload 的轻通道：页面里 console.log 标记 → 主进程动作
    win.webContents.on('console-message', (...args: unknown[]) => {
      const msg = args
        .map((a) =>
          typeof a === 'string'
            ? a
            : a && typeof a === 'object' && 'message' in a
              ? String((a as { message: unknown }).message)
              : '',
        )
        .join(' ');
      if (msg.includes('cw-popup-hover')) {
        clearTimeout(hideTimer); // 鼠标进入：暂停自动消失
      } else if (msg.includes('cw-popup-unhover')) {
        armHide(); // 鼠标移开：续上倒计时
      } else if (msg.includes('cw-popup-close')) {
        clearTimeout(hideTimer);
        win?.hide(); // × 只关掉，不聚焦主窗
      } else if (msg.includes('cw-popup-click')) {
        clearTimeout(hideTimer);
        win?.hide();
        onClickCb?.(); // 点内容 → 聚焦主窗
      }
    });
    win.on('closed', () => {
      win = null;
    });
  }
  const c = palette();
  const html = `<!doctype html><html><body onmouseenter="console.log('cw-popup-hover')" onmouseleave="console.log('cw-popup-unhover')" style="margin:0;position:relative;box-sizing:border-box;height:100vh;font:13px ui-monospace,monospace;-webkit-app-region:drag;background:${c.bg};border:2px solid ${c.border};color:${c.title};padding:10px 12px;overflow:hidden;-webkit-user-select:none">
<div onclick="console.log('cw-popup-click')" style="cursor:pointer">
<div style="color:${c.title};font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:16px">crab ▪ ${esc(title)}</div>
<div style="margin-top:5px;color:${c.body}">${esc(body)}</div>
</div>
<div onclick="event.stopPropagation();console.log('cw-popup-close')" title="close" onmouseover="this.style.color='${c.xHover}'" onmouseout="this.style.color='${c.x}'" style="-webkit-app-region:no-drag;position:absolute;top:3px;right:6px;cursor:pointer;color:${c.x};font-size:15px;line-height:1;padding:2px 4px">&times;</div>
</body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.showInactive();
  armHide(); // 显示即起 8s 倒计时（hover 暂停）
}
