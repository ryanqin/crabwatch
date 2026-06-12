import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { createEngine } from '../core/index.js';
import { wireIpc } from './ipcBridge.js';
import trayPng from '../../resources/tray.png?asset';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  let tray: Tray | null = null;
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
          const tlSlug = process.env['CW_CAPTURE_TIMELINE'];
          if (tlSlug) {
            await win?.webContents.executeJavaScript(
              `window.__cw.getState().openTimeline(${JSON.stringify(tlSlug)}, 'capture')`,
            );
            await new Promise((r) => setTimeout(r, 3000));
            await win?.webContents.executeJavaScript(
              `document.querySelector('.task-head')?.click()`,
            );
            await new Promise((r) => setTimeout(r, 400));
            await win?.webContents.executeJavaScript(
              `document.querySelectorAll('.seg-head')[1]?.click()`,
            );
            await new Promise((r) => setTimeout(r, 600));
            if (process.env['CW_CAPTURE_RAW']) {
              await win?.webContents.executeJavaScript(
                `document.querySelector('.seg-actions button:last-of-type')?.click()`,
              );
              await new Promise((r) => setTimeout(r, 1500));
            }
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

  function showWindow() {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else createWindow();
  }

  void app.whenReady().then(async () => {
    wireIpc(engine, () => win);
    createWindow();
    // 托盘常驻：关窗后引擎和 hooks 接收继续跑，从这里唤回
    tray = new Tray(
      nativeImage.createFromPath(trayPng).resize({ width: 18, height: 18 }),
    );
    tray.setToolTip('CrabWatch');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show CrabWatch', click: showWindow },
        { type: 'separator' },
        { label: 'Quit CrabWatch', click: () => app.quit() },
      ]),
    );
    tray.on('click', showWindow);
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
    // 常驻：窗口全关也不退出，引擎/托盘继续工作
  });
  app.on('before-quit', () => {
    engine.stop();
  });
}
