import { BrowserWindow, screen } from 'electron';

/**
 * 屏幕右上角的像素风通知浮窗（学 clawd-on-desk 的 bubble）：
 * 置顶、不抢焦点（showInactive + focusable:false），8s 自动收，点击聚焦主窗。
 * 单窗复用：新通知替换内容并重置定时器。
 */
let win: BrowserWindow | null = null;
let timer: NodeJS.Timeout | undefined;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function showPopup(title: string, body: string, onClick: () => void) {
  const W = 300;
  const H = 66;
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
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      hasShadow: false,
    });
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // 无 preload 的轻通道：页面点击打 console 标记，主进程聚焦主窗
    win.webContents.on('console-message', (...args: unknown[]) => {
      const hit = args.some((a) => {
        if (typeof a === 'string') return a.includes('cw-popup-click');
        if (a && typeof a === 'object' && 'message' in a)
          return String((a as { message: unknown }).message).includes(
            'cw-popup-click',
          );
        return false;
      });
      if (hit) {
        win?.hide();
        onClick();
      }
    });
    win.on('closed', () => {
      win = null;
    });
  }
  const html = `<!doctype html><html><body onclick="console.log('cw-popup-click')" style="margin:0;cursor:pointer;font:13px ui-monospace,monospace;background:#171b20;border:2px solid #c79a4e;color:#d6d9de;padding:10px 12px;overflow:hidden;-webkit-user-select:none">
<div style="color:#c79a4e;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">crab ▪ ${esc(title)}</div>
<div style="margin-top:5px;color:#a4abb5">${esc(body)}</div>
</body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.showInactive();
  clearTimeout(timer);
  timer = setTimeout(() => win?.hide(), 8000);
}
