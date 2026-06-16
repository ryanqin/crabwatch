import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { SessionWatcher } from './sessionWatcher.js';
import { TranscriptTail, readRecentLines } from './transcriptReader.js';
import { ProjectStore } from './projectStore.js';
import { HookServer, DEFAULT_HOOK_PORT } from './hookServer.js';
import { subagentsDirFor } from './paths.js';
import type { EngineEvents, SessionInfo } from '../shared/types.js';

export interface EngineOptions {
  /** transcript 轮询间隔（hooks 接入前的主路径，接入后是兜底） */
  pollTranscriptMs?: number;
  pollSessionsMs?: number;
  /** true = 从文件头读全部历史；false = 只 tail 新增（watch 模式默认） */
  tailFromStart?: boolean;
  /** 是否起本地 hook server（实时事件主路径） */
  hookServer?: boolean;
  hookPort?: number;
}

export declare interface Engine {
  on<E extends keyof EngineEvents>(event: E, listener: EngineEvents[E]): this;
  emit<E extends keyof EngineEvents>(
    event: E,
    ...args: Parameters<EngineEvents[E]>
  ): boolean;
}

export class Engine extends EventEmitter {
  readonly store = new ProjectStore();
  private watcher = new SessionWatcher();
  private hookServer?: HookServer;
  /** key: sessionId 或 sessionId/agentId */
  private tails = new Map<string, { tail: TranscriptTail; info: SessionInfo; agentId?: string }>();
  private timer?: NodeJS.Timeout;
  private polling = false;
  private pollAgain = false;

  constructor(private opts: EngineOptions = {}) {
    super();
  }

  async start(): Promise<void> {
    this.watcher.on('appeared', (live) => {
      const info = this.store.upsertLiveSession(live);
      void this.track(info);
      this.emit('session:appeared', info);
    });
    this.watcher.on('status', (live, prevStatus) => {
      const info = this.store.upsertLiveSession(live);
      this.emit('session:status', info, prevStatus);
    });
    this.watcher.on('gone', (live) => {
      const info = this.store.markGone(live);
      if (info) this.emit('session:gone', info);
    });
    await this.watcher.start(this.opts.pollSessionsMs ?? 1500);
    this.timer = setInterval(
      () => void this.pollTails(),
      this.opts.pollTranscriptMs ?? 1000,
    );

    if (this.opts.hookServer) {
      const port = this.opts.hookPort ?? DEFAULT_HOOK_PORT;
      this.hookServer = new HookServer();
      this.hookServer.on('event', (ev) => {
        this.emit('hook:event', ev);
        // 未知 session（刚启动）→ 立刻重扫；已知 → 立刻 tail，省掉轮询延迟
        if (ev.session_id && !this.store.get(ev.session_id))
          this.watcher.rescan();
        void this.pollTails();
      });
      this.hookServer.on('resolved', (id) =>
        this.emit('permission:resolved', id),
      );
      const ok = await this.hookServer.start(port);
      if (!ok) {
        this.hookServer = undefined;
        this.emit(
          'engine:degraded',
          `hook port ${port} in use — falling back to polling (1-2s latency)`,
        );
      }
    }
  }

  stop(): void {
    this.watcher.stop();
    this.hookServer?.stop();
    clearInterval(this.timer);
  }

  /** doctor 用：hookServer 运行时状态（undefined = 没启用 hook server） */
  hookServerStatus():
    | {
        listening: boolean;
        eventCount: number;
        lastEventAt?: number;
        lastByEvent: Record<string, number>;
        interactivePermissions: boolean;
        holdElicitation: boolean;
      }
    | undefined {
    if (!this.hookServer) return undefined;
    return {
      listening: this.hookServer.listening,
      eventCount: this.hookServer.eventCount,
      lastEventAt: this.hookServer.lastEventAt,
      lastByEvent: Object.fromEntries(this.hookServer.lastByEvent),
      interactivePermissions: this.hookServer.interactivePermissions,
      holdElicitation: this.hookServer.holdElicitation,
    };
  }

  setInteractivePermissions(on: boolean): void {
    if (this.hookServer) this.hookServer.interactivePermissions = on;
  }

  setHoldElicitation(on: boolean): void {
    if (this.hookServer) this.hookServer.holdElicitation = on;
  }

  resolvePermission(
    id: string,
    behavior?: 'allow' | 'deny',
    extra?: Record<string, unknown>,
  ): boolean {
    return this.hookServer?.resolvePermission(id, behavior, extra) ?? false;
  }

  private async track(info: SessionInfo): Promise<void> {
    if (this.tails.has(info.sessionId)) return;
    const tail = new TranscriptTail(info.transcriptPath);
    if (!this.opts.tailFromStart) await tail.seekToEnd();
    this.tails.set(info.sessionId, { tail, info });
    // 回读 transcript 元信息：cwd 众数=主战目录名（roster 用），最新 ai-title=描述性标题
    void this.recoverMeta(info);
  }

  /**
   * 存量 session 的 ai-title / 早期 cwd 写在 seek 点之前、tail 读不到 → 回读末尾窗口：
   * 取 cwd 众数（真正主战目录，不是启动根目录）+ 最新 ai-title，补发一条带 cwd(+title) 的
   * transcript:lines，让 renderer 的 bumpCwd 据 cwd 定名、setCrab 据 title 定标题。
   */
  private async recoverMeta(info: SessionInfo): Promise<void> {
    try {
      const lines = await readRecentLines(
        info.transcriptPath,
        5000,
        4 * 1024 * 1024,
      );
      let title: string | undefined;
      const cwds = new Map<string, number>();
      for (const pl of lines) {
        const l = pl.line;
        if (l.kind === 'ai-title' && l.title) title = l.title; // 取最新
        if (l.cwd) cwds.set(l.cwd, (cwds.get(l.cwd) ?? 0) + 1);
      }
      let cwd: string | undefined;
      let best = 0;
      for (const [c, n] of cwds) if (n > best) ((cwd = c), (best = n));
      if (!title && !cwd) return;
      if (title) {
        info.title = title;
        this.store.setTitle(info.sessionId, title);
      }
      this.emit('transcript:lines', {
        sessionId: info.sessionId,
        projectSlug: info.projectSlug,
        lines: [
          {
            lineNo: 0,
            byteStart: 0,
            byteEnd: 0,
            line: title
              ? { kind: 'ai-title', rawType: 'ai-title', title, cwd }
              : { kind: 'unknown', rawType: 'unknown', cwd },
          },
        ],
      });
    } catch {
      /* 回读失败就退回目录名 */
    }
  }

  /** 发现该 session 新出现的 subagent transcript 并挂为子 tail */
  private async discoverSubagents(info: SessionInfo): Promise<void> {
    const dir = subagentsDirFor(info.projectPath, info.sessionId);
    let files: string[] = [];
    try {
      files = await fsp.readdir(dir);
    } catch {
      return;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const agentId = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
      const key = `${info.sessionId}/${agentId}`;
      if (this.tails.has(key)) continue;
      const tail = new TranscriptTail(path.join(dir, f));
      // subagent 文件出现即从头读：它的历史就是本轮任务
      this.tails.set(key, { tail, info, agentId });
    }
  }

  private async pollTails(): Promise<void> {
    if (this.polling) {
      this.pollAgain = true; // hook 触发时若已在读，读完再补一轮，不丢事件
      return;
    }
    this.polling = true;
    try {
      for (const { info } of [...this.tails.values()].filter((t) => !t.agentId)) {
        if (info.isLive) await this.discoverSubagents(info);
      }
      for (const { tail, info, agentId } of this.tails.values()) {
        let lines;
        try {
          lines = await tail.readNew();
        } catch (err) {
          this.emit('engine:error', err as Error);
          continue;
        }
        if (lines.length === 0) continue;
        for (const pl of lines) {
          if (pl.line.kind === 'ai-title' && !agentId) {
            this.store.setTitle(info.sessionId, pl.line.title);
          }
        }
        this.emit('transcript:lines', {
          sessionId: info.sessionId,
          projectSlug: info.projectSlug,
          agentId,
          lines,
        });
      }
    } finally {
      this.polling = false;
      if (this.pollAgain) {
        this.pollAgain = false;
        void this.pollTails();
      }
    }
  }
}

export function createEngine(opts: EngineOptions = {}): Engine {
  return new Engine(opts);
}
