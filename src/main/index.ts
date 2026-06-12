import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createEngine } from '../core/index.js';
import { wireIpc } from './ipcBridge.js';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  const engine = createEngine({ tailFromStart: false, hookServer: true });

  function createWindow() {
    win = new BrowserWindow({
      width: 1340,
      height: 860,
      title: 'CrabWatch',
      backgroundColor: '#10222e',
      webPreferences: {
        preload: path.join(import.meta.dirname, '../preload/index.mjs'),
        sandbox: false,
      },
    });
    win.on('closed', () => {
      win = null;
    });
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl) void win.loadURL(devUrl);
    else
      void win.loadFile(
        path.join(import.meta.dirname, '../renderer/index.html'),
      );

    // 自验证：CW_CAPTURE=/path/out.png 时延迟截图（开发用）
    const capturePath = process.env['CW_CAPTURE'];
    if (capturePath) {
      win.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          if (process.env['CW_CAPTURE_SELECT']) {
            await win?.webContents.executeJavaScript(
              `(() => { const s = window.__cw.getState(); const id = Object.keys(s.crabs)[0]; if (id) s.select(id); })()`,
            );
            await new Promise((r) => setTimeout(r, 1200));
          }
          const img = await win?.webContents.capturePage();
          if (img) {
            const { writeFileSync } = await import('node:fs');
            writeFileSync(capturePath, img.toPNG());
            console.log(`[capture] ${capturePath}`);
          }
        }, 5000);
      });
    }
  }

  void app.whenReady().then(async () => {
    wireIpc(engine, () => win);
    createWindow();
    await engine.start();
  });

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on('activate', () => {
    if (!win) createWindow();
  });
  app.on('window-all-closed', () => {
    engine.stop();
    app.quit();
  });
}
