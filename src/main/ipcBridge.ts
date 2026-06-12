import { app, ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { Engine } from '../core/index.js';
import { readRecentLines } from '../core/transcriptReader.js';
import {
  buildProjectTimeline,
  listProjects,
  readRawRange,
} from '../core/audit/projectTimeline.js';
import { Summarizer } from '../core/summarizer.js';
import { UsageService } from '../core/usageService.js';
import type { EngineEventMessage, InitState } from '../shared/ipc.js';
import type { Segment } from '../shared/types.js';

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

  const cacheDir = path.join(app.getPath('userData'), 'cache');
  ipcMain.handle('cw:listProjects', () => {
    const liveSlugs = new Set(
      engine.store
        .all()
        .filter((s) => s.isLive)
        .map((s) => s.projectSlug),
    );
    return listProjects(liveSlugs);
  });
  ipcMain.handle('cw:getTimeline', (_e, slug: string) =>
    buildProjectTimeline(slug, cacheDir),
  );
  ipcMain.handle(
    'cw:getRaw',
    (_e, transcriptPath: string, byteStart: number, byteEnd: number) =>
      readRawRange(transcriptPath, byteStart, byteEnd),
  );

  const summarizer = new Summarizer(cacheDir);
  ipcMain.handle('cw:summarize', (_e, seg: Segment, projectName: string) =>
    summarizer.summarize(seg, projectName),
  );

  const usage = new UsageService();
  ipcMain.handle('cw:getUsage', () => usage.get());
}
