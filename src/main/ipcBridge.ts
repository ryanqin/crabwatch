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
import { runDoctor } from '../core/doctor.js';
import { planInstall, applyPlan } from '../core/hookInstaller.js';
import { RemoteManager, type RemoteProfile } from '../core/remoteManager.js';
import { focusTerminal } from './terminalFocus.js';
import { sendToSession } from './sendMessage.js';
import {
  setFloating,
  isFloatingVisible,
  getFloatingWindow,
  setFloatingHeight,
} from './floatingWindow.js';
import { showPopup } from './popup.js';
import {
  showQuestionBubble,
  closeQuestionBubble,
  setBubbleHeight,
} from './questionBubble.js';
import { organize } from '../core/sessionNamer.js';
import { UsageService } from '../core/usageService.js';
import type { EngineEventMessage, InitState } from '../shared/ipc.js';
import type { Segment } from '../shared/types.js';

export function wireIpc(
  engine: Engine,
  getWin: () => BrowserWindow | null,
  showWindow: () => void,
  preloadPath: string,
  refreshTray: () => void = () => {},
) {
  let degraded: string | undefined;
  // 广播给主窗 + 略缩悬浮窗（各自独立 store，同一份引擎事件喂两边）
  const send = (msg: EngineEventMessage) => {
    getWin()?.webContents.send('engine-event', msg);
    const fw = getFloatingWindow();
    if (fw && !fw.isDestroyed()) fw.webContents.send('engine-event', msg);
  };

  engine.on('session:appeared', (info) => send({ type: 'session:appeared', info }));
  engine.on('session:status', (info, prevStatus) =>
    send({ type: 'session:status', info, prevStatus }),
  );
  engine.on('session:gone', (info) => send({ type: 'session:gone', info }));
  engine.on('transcript:lines', (batch) => send({ type: 'transcript:lines', batch }));
  // 同一 session 同一问题去重：AskUserQuestion 可能同时触发 Elicitation 和
  // PermissionRequest 两条 hook，两个开关都开会各挂一个。指纹相同的第二个直接
  // 放行（无意见 {}），只留一个气泡。
  const recentBubble = new Map<string, number>();
  engine.on('hook:event', (ev) => {
    send({ type: 'hook:event', ev });
    // 独立桌面气泡（复刻 clawd）：permissionId 存在 = hookServer 挂起了它，才弹。
    // Elicitation→问答；ExitPlanMode→计划复审；其余 PermissionRequest→权限 allow/deny。
    const permId = (ev as { permissionId?: string }).permissionId;
    if (!permId) return;
    const fp = `${ev.session_id ?? ''}:${JSON.stringify(ev.tool_input ?? {})}`;
    const now = Date.now();
    for (const [k, t] of recentBubble) if (now - t > 8000) recentBubble.delete(k);
    if (recentBubble.has(fp)) {
      engine.resolvePermission(permId, undefined); // 重复 hook：放行，不二次弹窗
      return;
    }
    recentBubble.set(fp, now);
    const sid = ev.session_id;
    const info = sid ? engine.store.get(sid) : undefined;
    const toolName = ev.tool_name ?? 'tool';
    const input = (ev.tool_input ?? {}) as Record<string, unknown>;
    // 问答可能经 Elicitation 或 PermissionRequest(toolName=AskUserQuestion)两条路来；
    // 只要载荷带 questions 数组就当问答渲染表单，绝不落到 JSON 分支
    const hasQuestions = Array.isArray(input.questions);
    const kind: 'question' | 'plan' | 'permission' =
      ev.hook_event_name === 'Elicitation' ||
      toolName === 'AskUserQuestion' ||
      hasQuestions
        ? 'question'
        : toolName === 'ExitPlanMode' || typeof input.plan === 'string'
          ? 'plan'
          : 'permission';
    showQuestionBubble({
      permId,
      sessionId: sid,
      sessionName: info?.projectName ?? 'session',
      kind,
      toolName,
      toolInput: input,
      suggestions: Array.isArray(
        (ev as { permission_suggestions?: unknown[] }).permission_suggestions,
      )
        ? (ev as { permission_suggestions?: unknown[] }).permission_suggestions
        : [],
      preloadPath,
      onClosed: (id) => engine.resolvePermission(id, undefined),
    });
  });
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
  ipcMain.handle('cw:setQuestionBubble', (_e, on: boolean) =>
    engine.setHoldElicitation(on),
  );
  // sessionId → 本地终端定位所需的 pid + title。远程 session 没有本地 pid，返回 null。
  // 主进程只 tail 新行，存量 session 的 title 不在内存——现场回捞最新 ai-title。
  const liveTarget = async (
    sessionId: string,
  ): Promise<{ pid: number; title?: string } | null> => {
    // 远程 session 是 renderer 从 hook 事件合成的，不在本地 engine.store 里 → info 自然为空
    const info = engine.store.get(sessionId);
    if (!info?.pid) return null;
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
    return { pid: info.pid, title };
  };
  ipcMain.handle('cw:focusTerminal', async (_e, sessionId: string) => {
    const t = await liveTarget(sessionId);
    return t ? focusTerminal(t.pid, t.title) : false;
  });
  ipcMain.handle(
    'cw:sendToSession',
    async (_e, sessionId: string, text: string, submit?: boolean) => {
      const t = await liveTarget(sessionId);
      if (!t) return { ok: false, reason: 'no-terminal' as const };
      return sendToSession(t.pid, t.title, text, submit ?? true);
    },
  );

  // 略缩悬浮 roster 窗
  ipcMain.handle('cw:setFloating', (_e, on: boolean) => {
    const vis = setFloating(on, preloadPath);
    refreshTray(); // 托盘勾选状态同步
    return vis;
  });
  ipcMain.handle('cw:getFloating', () => isFloatingVisible());
  ipcMain.on('cw:reportFloatingHeight', (_e, height: number) =>
    setFloatingHeight(height),
  );
  // 悬浮窗点行：展开主窗，等渲染就绪后推送选中（新建窗时 listener 可能还没挂，等 load 完）
  ipcMain.handle('cw:openMain', (_e, sessionId: string) => {
    showWindow();
    const w = getWin();
    if (!w) return;
    if (w.webContents.isLoading())
      w.webContents.once('did-finish-load', () =>
        w.webContents.send('cw:focusSession', sessionId),
      );
    else w.webContents.send('cw:focusSession', sessionId);
  });
  ipcMain.handle(
    'cw:respondPermission',
    (
      _e,
      id: string,
      behavior: 'allow' | 'deny' | undefined,
      extra?: Record<string, unknown>,
    ) => {
      const ok = engine.resolvePermission(id, behavior, extra);
      closeQuestionBubble(id); // 同一 perm 的其它气泡/卡片同步收掉
      return ok;
    },
  );
  ipcMain.handle('cw:setAutoLaunch', (_e, on: boolean) => {
    app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true });
    return autoLaunchState();
  });
  ipcMain.handle('cw:showPopup', (_e, title: string, body: string) =>
    showPopup(title, body, showWindow),
  );
  ipcMain.on('cw:reportBubbleHeight', (_e, permId: string, height: number) =>
    setBubbleHeight(permId, height),
  );

  ipcMain.handle('cw:runDoctor', () => runDoctor(engine.hookServerStatus()));

  // 远程 SSH 监控：隧道把远程 hook 事件转发回本地 hookServer，远程 session 上沙滩
  const remotes = new RemoteManager();
  void remotes.load();
  remotes.on('state', (state) => send({ type: 'remote:state', state }));
  ipcMain.handle('cw:remoteList', () => ({
    profiles: remotes.list(),
    states: remotes.statesList(),
  }));
  ipcMain.handle('cw:remoteUpsert', (_e, p: RemoteProfile) => remotes.upsert(p));
  ipcMain.handle('cw:remoteRemove', (_e, id: string) => remotes.remove(id));
  ipcMain.handle('cw:remoteConnect', (_e, id: string) => remotes.connect(id));
  ipcMain.handle('cw:remoteDisconnect', (_e, id: string) =>
    remotes.disconnect(id),
  );
  ipcMain.handle('cw:remoteDeploy', (_e, id: string) => remotes.deployHooks(id));
  ipcMain.handle('cw:reinstallHooks', async () => {
    const plan = await planInstall('install');
    await applyPlan(plan);
    return plan.actions;
  });

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

  // 给 index.ts 在退出时收掉 ssh 隧道子进程（避免遗留孤儿隧道）
  return { stopRemotes: () => remotes.stop() };
}
