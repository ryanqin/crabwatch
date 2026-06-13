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

/** 挂起的 PermissionRequest 在这个时限内没人点就回「无意见」（curl -m 55 兜底在外层） */
const PERMISSION_HOLD_MS = 50_000;

/** 本地 HTTP 接收 Claude Code hooks POST。bind 失败返回 false（调用方降级纯轮询）。 */
export class HookServer extends EventEmitter {
  private server?: http.Server;
  private pending = new Map<
    string,
    { res: http.ServerResponse; timer: NodeJS.Timeout; eventName: string }
  >();
  private permSeq = 0;
  /** 开着才挂起权限请求等 UI 决定；关着照旧秒回（默认关） */
  interactivePermissions = false;

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
          let ev: HookEvent | undefined;
          if (!overflow) {
            try {
              const parsed = JSON.parse(body) as HookEvent;
              if (parsed && typeof parsed.hook_event_name === 'string')
                ev = parsed;
            } catch {
              /* 非 JSON 载荷忽略 */
            }
          }

          // 权限卡开启时挂起 PermissionRequest / Elicitation（AskUserQuestion 问答），等 UI 决定再回
          if (
            ev &&
            (ev.hook_event_name === 'PermissionRequest' ||
              ev.hook_event_name === 'Elicitation') &&
            this.interactivePermissions
          ) {
            const id = `perm-${++this.permSeq}-${Date.now()}`;
            const timer = setTimeout(
              () => this.resolvePermission(id, undefined),
              PERMISSION_HOLD_MS,
            );
            this.pending.set(id, { res, timer, eventName: ev.hook_event_name });
            // 只在响应未正常结束就断开（curl 超时/被杀）时清理；
            // 注意 req 的 close 在请求体读完就会触发，不能用它
            res.on('close', () => {
              if (!res.writableEnded) {
                const p = this.pending.get(id);
                if (p) {
                  clearTimeout(p.timer);
                  this.pending.delete(id);
                }
              }
            });
            this.emit('event', { ...ev, permissionId: id });
            return;
          }

          // 其余事件永远秒回，绝不拖住 Claude Code
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{}');
          if (ev) this.emit('event', ev);
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

  /**
   * UI 的决定写回挂起的 hook 请求；behavior 为空 = 无意见（回落终端提示）。
   * updatedInput 仅对 allow 有意义——Elicitation（AskUserQuestion）用它预填
   * answers，Claude Code 拿到后跳过终端询问（机制学 clawd-on-desk）。
   */
  resolvePermission(
    id: string,
    behavior?: 'allow' | 'deny',
    updatedInput?: Record<string, unknown>,
  ): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (p.res.writableEnded || p.res.destroyed) return false;
    const decision: Record<string, unknown> = { behavior };
    if (behavior === 'allow' && updatedInput) decision.updatedInput = updatedInput;
    const bodyOut = behavior
      ? JSON.stringify({
          hookSpecificOutput: {
            hookEventName: p.eventName,
            decision,
          },
        })
      : '{}';
    p.res.writeHead(200, { 'content-type': 'application/json' });
    p.res.end(bodyOut);
    return true;
  }

  stop(): void {
    for (const id of [...this.pending.keys()]) this.resolvePermission(id);
    this.server?.close();
  }
}
