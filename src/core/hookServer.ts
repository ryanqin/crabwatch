import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { HookEvent } from '../shared/types.js';

export const DEFAULT_HOOK_PORT = 48761;
/** 带 crabwatch 标记的路径，hookInstaller 靠它识别哪些 settings.json 条目是我们的 */
export const HOOK_PATH = '/crabwatch-events';

export interface HookServerEvents {
  event: (ev: HookEvent) => void;
}

export declare interface HookServer {
  on<E extends keyof HookServerEvents>(
    event: E,
    listener: HookServerEvents[E],
  ): this;
  emit<E extends keyof HookServerEvents>(
    event: E,
    ...args: Parameters<HookServerEvents[E]>
  ): boolean;
}

/** 本地 HTTP 接收 Claude Code hooks POST。bind 失败返回 false（调用方降级纯轮询）。 */
export class HookServer extends EventEmitter {
  private server?: http.Server;

  start(port = DEFAULT_HOOK_PORT): Promise<boolean> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        if (req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"ok":true,"name":"crabwatch"}');
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405).end();
          return;
        }
        let body = '';
        let overflow = false;
        req.on('data', (c) => {
          body += c;
          if (body.length > 1 << 20) {
            overflow = true;
            req.destroy();
          }
        });
        req.on('end', () => {
          // 永远秒回，绝不拖住 Claude Code
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{}');
          if (overflow) return;
          try {
            const ev = JSON.parse(body) as HookEvent;
            if (ev && typeof ev.hook_event_name === 'string')
              this.emit('event', ev);
          } catch {
            /* 非 JSON 载荷忽略 */
          }
        });
        req.on('error', () => {});
      });
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => {
        this.server = server;
        resolve(true);
      });
    });
  }

  stop(): void {
    this.server?.close();
  }
}
