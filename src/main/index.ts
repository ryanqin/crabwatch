import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import fs from 'node:fs';
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
  const preloadPath = path.join(import.meta.dirname, '../preload/index.mjs');

  function createWindow() {
    win = new BrowserWindow({
      width: 1340,
      height: 860,
      title: 'CrabWatch',
      backgroundColor: '#10222e',
      webPreferences: {
        preload: preloadPath,
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
            // session 卡片默认折叠，先展开第一个才有 seg-head 可点
            await win?.webContents.executeJavaScript(
              `document.querySelector('.session-card-head')?.click()`,
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
          // 任意前置交互（如点开 HUD 下拉）：CW_CAPTURE_JS='document.querySelectorAll(".hud-btn")[1].click()'
          const captureJs = process.env['CW_CAPTURE_JS'];
          if (captureJs) {
            await win?.webContents.executeJavaScript(captureJs);
            await new Promise((r) => setTimeout(r, 600));
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
    wireIpc(engine, () => win, showWindow, preloadPath);
    createWindow();
    // 托盘常驻：关窗后引擎和 hooks 接收继续跑，从这里唤回
    // template image：黑剪影由系统按菜单栏明暗渲染（暗=白/亮=黑）。
    // 读取走 fs（asar 补丁保证包内可读，createFromPath 读不到 asar 时会静默给空图=透明托盘）；
    // 32px 当 2x（16pt），retina 菜单栏不糊
    const trayImg = nativeImage.createFromBuffer(fs.readFileSync(trayPng), {
      scaleFactor: 2,
    });
    trayImg.setTemplateImage(true);
    tray = new Tray(trayImg);
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

    // 自验证：CW_TEST_BUBBLE=1 启动后弹一个示例问答气泡（开发用）
    if (process.env['CW_TEST_BUBBLE']) {
      const { showQuestionBubble } = await import('./questionBubble.js');
      setTimeout(() => {
        showQuestionBubble(
          'test-perm',
          undefined,
          'tideline',
          {
            questions: [
              {
                question: '解锁一下?(验去重后的海滩:同场景只剩一只蟹)',
                options: [
                  { label: '解锁了,继续', description: '截图取证后 commit+push' },
                  { label: '我自己看,直接 commit', description: '单测已锁(4/4),不用截图' },
                ],
              },
            ],
          },
          preloadPath,
          () => {},
        );
      }, 2500);
    }
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
