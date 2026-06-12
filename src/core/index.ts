import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { SessionWatcher } from './sessionWatcher.js';
import { TranscriptTail } from './transcriptReader.js';
import { ProjectStore } from './projectStore.js';
import { subagentsDirFor } from './paths.js';
import type { EngineEvents, SessionInfo } from '../shared/types.js';

export interface EngineOptions {
  /** transcript 轮询间隔（hooks 接入前的主路径，接入后是兜底） */
  pollTranscriptMs?: number;
  pollSessionsMs?: number;
  /** true = 从文件头读全部历史；false = 只 tail 新增（watch 模式默认） */
  tailFromStart?: boolean;
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
  /** key: sessionId 或 sessionId/agentId */
  private tails = new Map<string, { tail: TranscriptTail; info: SessionInfo; agentId?: string }>();
  private timer?: NodeJS.Timeout;
  private polling = false;

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
  }

  stop(): void {
    this.watcher.stop();
    clearInterval(this.timer);
  }

  private async track(info: SessionInfo): Promise<void> {
    if (this.tails.has(info.sessionId)) return;
    const tail = new TranscriptTail(info.transcriptPath);
    if (!this.opts.tailFromStart) await tail.seekToEnd();
    this.tails.set(info.sessionId, { tail, info });
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
    if (this.polling) return;
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
    }
  }
}

export function createEngine(opts: EngineOptions = {}): Engine {
  return new Engine(opts);
}
