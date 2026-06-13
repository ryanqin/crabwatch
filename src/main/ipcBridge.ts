import { app, ipcMain, type BrowserWindow } from 'electron';
import type { Engine } from '../core/index.js';
import { defaultCacheDir } from '../core/cacheStore.js';
import { parseTranscriptLine } from '../core/transcriptParse.js';
import { readRecentLines } from '../core/transcriptReader.js';
import {
  buildProjectTimeline,
  listProjects,
  readRawRange,
} from '../core/audit/projectTimeline.js';
import { Summarizer } from '../core/summarizer.js';
import { Storyteller } from '../core/storyteller.js';
import { focusTerminal } from './terminalFocus.js';
import { showPopup } from './popup.js';
import { organize } from '../core/sessionNamer.js';
import { UsageService } from '../core/usageService.js';
import type { EngineEventMessage, InitState } from '../shared/ipc.js';
import type { Segment } from '../shared/types.js';

export function wireIpc(
  engine: Engine,
  getWin: () => BrowserWindow | null,
  showWindow: () => void,
) {
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

  // 与 CLI 共用缓存（audit/names/clusters 互通）
  const cacheDir = defaultCacheDir;
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
    async (_e, transcriptPath: string, byteStart: number, byteEnd: number) => {
      const text = await readRawRange(transcriptPath, byteStart, byteEnd);
      const lines = text
        .split('\n')
        .filter((l) => l.trim())
        .map((raw, i) => ({
          lineNo: i,
          byteStart: 0,
          byteEnd: 0,
          line: parseTranscriptLine(raw),
        }));
      return { text, lines };
    },
  );

  const summarizer = new Summarizer(cacheDir);
  ipcMain.handle('cw:summarize', (_e, seg: Segment, projectName: string) =>
    summarizer.summarize(seg, projectName),
  );

  ipcMain.handle('cw:organize', async (_e, slug: string, cachedOnly: boolean) => {
    const entries = await buildProjectTimeline(slug, cacheDir);
    return organize(entries, cacheDir, slug, cachedOnly, (done, total) =>
      send({ type: 'organize:progress', done, total }),
    );
  });

  const usage = new UsageService();
  ipcMain.handle('cw:getUsage', () => usage.get());

  const autoLaunchState = () => ({
    enabled: app.getLoginItemSettings().openAtLogin,
    packaged: app.isPackaged,
  });
  ipcMain.handle('cw:getAutoLaunch', () => autoLaunchState());
  ipcMain.handle('cw:setPermissionCards', (_e, on: boolean) =>
    engine.setInteractivePermissions(on),
  );
  ipcMain.handle('cw:focusTerminal', async (_e, sessionId: string) => {
    const info = engine.store.get(sessionId);
    if (!info?.pid) return false;
    // 主进程只 tail 新行，存量 session 的 title 不在内存——现场回捞最新 ai-title
    let title = info.title;
    if (!title) {
      const lines = await readRecentLines(
        info.transcriptPath,
        5000,
        4 * 1024 * 1024,
      );
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i].line;
        if (l.kind === 'ai-title' && l.title) {
          title = l.title;
          break;
        }
      }
    }
    return focusTerminal(info.pid, title);
  });
  ipcMain.handle(
    'cw:respondPermission',
    (
      _e,
      id: string,
      behavior: 'allow' | 'deny',
      updatedInput?: Record<string, unknown>,
    ) => engine.resolvePermission(id, behavior, updatedInput),
  );
  ipcMain.handle('cw:setAutoLaunch', (_e, on: boolean) => {
    app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true });
    return autoLaunchState();
  });
  ipcMain.handle('cw:showPopup', (_e, title: string, body: string) =>
    showPopup(title, body, showWindow),
  );

  const storyteller = new Storyteller(cacheDir);
  ipcMain.handle(
    'cw:story',
    async (
      _e,
      slug: string,
      projectName: string,
      sinceTs: string,
      force: boolean,
    ) => {
      const entries = await buildProjectTimeline(slug, cacheDir);
      return storyteller.tell(entries, projectName, sinceTs, force);
    },
  );
}
