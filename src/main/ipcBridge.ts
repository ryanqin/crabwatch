import { ipcMain, type BrowserWindow } from 'electron';
import type { Engine } from '../core/index.js';
import { readRecentLines } from '../core/transcriptReader.js';
import type { EngineEventMessage, InitState } from '../shared/ipc.js';

export function wireIpc(engine: Engine, getWin: () => BrowserWindow | null) {
  let degraded: string | undefined;
  const send = (msg: EngineEventMessage) => {
    getWin()?.webContents.send('engine-event', msg);
  };

  engine.on('session:appeared', (info) => send({ type: 'session:appeared', info }));
  engine.on('session:status', (info, prevStatus) =>
    send({ type: 'session:status', info, prevStatus }),
  );
  engine.on('session:gone', (info) => send({ type: 'session:gone', info }));
  engine.on('transcript:lines', (batch) => send({ type: 'transcript:lines', batch }));
  engine.on('hook:event', (ev) => send({ type: 'hook:event', ev }));
  engine.on('engine:degraded', (reason) => {
    degraded = reason;
    send({ type: 'engine:degraded', reason });
  });

  ipcMain.handle('cw:init', (): InitState => {
    return { sessions: engine.store.all().filter((s) => s.isLive), degraded };
  });
  ipcMain.handle('cw:getRecent', async (_e, sessionId: string, n: number) => {
    const info = engine.store.get(sessionId);
    if (!info) return [];
    return readRecentLines(info.transcriptPath, n);
  });
}
