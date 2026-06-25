import { BrowserWindow, screen, nativeTheme } from 'electron';

/**
 * 屏幕角落的像素风通知浮窗（学 clawd-on-desk 的 bubble）：置顶、不抢焦点（showInactive）。
 * **可拖动** + **8s 自动消失**（hover/拖动时暂停倒计时、移开再续）。
 *
 * 关闭：**点气泡任意处都只是关掉它**（× 是明显的关闭标记；瞄 × 没瞄准、点到中间也只是关、
 * 不会误跳转——之前点正文会聚焦主窗，和点 × 打架）。
 * ⚠️ 所有交互都在页面内自理：自动消失 + hover 暂停用页内 setTimeout，× 与点击都用
 * window.close()。**不再用 console.log→console-message 那套（Electron 37 下不可靠，
 * × 点了没反应的根因）**。单窗复用：新通知替换内容、重置倒计时；颜色跟随白天/黑夜主题。
 */
let win: BrowserWindow | null = null;
const AUTO_HIDE_MS = 8000;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
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

export function showPopup(
  title: string,
  body: string,
  preloadPath: string,
  sticky = false, // true=不自动消失（仅测试用，CW_TEST_POPUP），一直挂到点掉
) {
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
      movable: true, // 可拖（配 body 的 -webkit-app-region: drag）
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true, // 允许点选；仍用 showInactive，出现时不抢焦点
      show: false,
      hasShadow: false,
      // preload 让页内 inline onclick 能调 window.crabwatch.openMain()（点通知 → 聚焦主窗）
      webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: false },
    });
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on('closed', () => {
      win = null;
    });
  }
  const c = palette();
  // content=no-drag 保证点击稳定触发（拖窗靠四周留白/标题栏空隙）；× 单独 no-drag + 大点的命中区
  const html = `<!doctype html><html><body style="margin:0;position:relative;box-sizing:border-box;height:100vh;font:13px ui-monospace,monospace;-webkit-app-region:drag;background:${c.bg};border:2px solid ${c.border};color:${c.title};padding:10px 12px;overflow:hidden;-webkit-user-select:none">
<div onclick="window.close()" title="click to dismiss" style="-webkit-app-region:no-drag;cursor:pointer">
<div style="color:${c.title};font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:18px">crab ▪ ${esc(title)}</div>
<div style="margin-top:5px;color:${c.body}">${esc(body)}</div>
</div>
<div onclick="event.stopPropagation();window.close()" title="close" onmouseover="this.style.color='${c.xHover}'" onmouseout="this.style.color='${c.x}'" style="-webkit-app-region:no-drag;position:absolute;top:2px;right:4px;cursor:pointer;color:${c.x};font-size:16px;line-height:1;padding:4px 8px">&times;</div>
<script>
  // 自动消失 + hover 暂停，全在页内（不依赖主进程/console-message）。sticky=测试时不自动消失。
  ${
    sticky
      ? ''
      : `let t = setTimeout(function(){ window.close(); }, ${AUTO_HIDE_MS});
  document.body.addEventListener('mouseenter', function(){ clearTimeout(t); });
  document.body.addEventListener('mouseleave', function(){ clearTimeout(t); t = setTimeout(function(){ window.close(); }, ${AUTO_HIDE_MS}); });`
  }
</script>
</body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.showInactive();
}
