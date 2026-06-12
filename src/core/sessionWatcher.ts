import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { sessionsDir } from './paths.js';
import type { LiveSessionFile } from '../shared/types.js';

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = 进程存在但无权限发信号
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface SessionWatcherEvents {
  appeared: (live: LiveSessionFile) => void;
  status: (live: LiveSessionFile, prevStatus: string) => void;
  gone: (live: LiveSessionFile) => void;
}

export declare interface SessionWatcher {
  on<E extends keyof SessionWatcherEvents>(
    event: E,
    listener: SessionWatcherEvents[E],
  ): this;
  emit<E extends keyof SessionWatcherEvents>(
    event: E,
    ...args: Parameters<SessionWatcherEvents[E]>
  ): boolean;
}

/** 轮询 ~/.claude/sessions/*.json + fs.watch 即时触发，PID 活性校验过滤残留文件 */
export class SessionWatcher extends EventEmitter {
  private known = new Map<number, LiveSessionFile>();
  private timer?: NodeJS.Timeout;
  private watcher?: fs.FSWatcher;
  private debounce?: NodeJS.Timeout;
  private scanning = false;

  async start(intervalMs = 1500): Promise<void> {
    await this.scan();
    this.timer = setInterval(() => void this.scan(), intervalMs);
    try {
      this.watcher = fs.watch(sessionsDir, () => {
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.scan(), 200);
      });
    } catch {
      // 目录暂不存在等情况：纯轮询兜底
    }
  }

  stop(): void {
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.watcher?.close();
  }

  current(): LiveSessionFile[] {
    return [...this.known.values()];
  }

  /** hook 事件等外部信号触发的即时重扫 */
  rescan(): void {
    void this.scan();
  }

  private async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      let files: string[] = [];
      try {
        files = await fsp.readdir(sessionsDir);
      } catch {
        files = [];
      }
      const seen = new Set<number>();
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        let data: LiveSessionFile;
        try {
          data = JSON.parse(
            await fsp.readFile(path.join(sessionsDir, f), 'utf8'),
          ) as LiveSessionFile;
        } catch {
          continue;
        }
        if (!data?.sessionId || !data?.pid || !data?.cwd) continue;
        if (!pidAlive(data.pid)) continue; // crash 残留
        seen.add(data.pid);
        const prev = this.known.get(data.pid);
        this.known.set(data.pid, data);
        if (!prev) this.emit('appeared', data);
        else if (prev.status !== data.status)
          this.emit('status', data, prev.status);
      }
      for (const [pid, info] of this.known) {
        if (!seen.has(pid)) {
          this.known.delete(pid);
          this.emit('gone', info);
        }
      }
    } finally {
      this.scanning = false;
    }
  }
}
