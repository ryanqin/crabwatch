import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { HookEvent } from '../shared/types.js';

export const DEFAULT_HOOK_PORT = 48761;
/** 带 crabwatch 标记的路径，hookInstaller 靠它识别哪些 settings.json 条目是我们的 */
export const HOOK_PATH = '/crabwatch-events';

export interface HookServerEvents {
  event: (ev: HookEvent) => void;
  /** 某挂起的权限/问答被解决（作答/超时/连接断开任一路径）→ UI 即时收掉对应提示 */
  resolved: (id: string) => void;
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

/** 挂起的 PermissionRequest/Elicitation 在这个时限内没人点就回「无意见」（回落终端）。
 *  放到 5 分钟：权限/问答时 Claude Code 本就在等输入，actively 选择时绝不该被中途收掉
 *  （旧值 50s 太短，用户常选到一半就消失）。外层 curl -m 360 ＞此值才收得到响应；CC
 *  hook 默认超时 600s ＞两者，不会提前杀 curl。想立刻回终端，UI 上点「to terminal」。 */
const PERMISSION_HOLD_MS = 300_000;

/** 本地 HTTP 接收 Claude Code hooks POST。bind 失败返回 false（调用方降级纯轮询）。 */
export class HookServer extends EventEmitter {
  private server?: http.Server;
  private pending = new Map<
    string,
    {
      res: http.ServerResponse;
      timer: NodeJS.Timeout;
      eventName: string;
      /** 作答后按 session/agent/tool 精确收掉用：身份取自挂起时那条 hook */
      sessionId?: string;
      agentId?: string;
      toolName?: string;
      remoteSource?: string;
      toolUseId?: string;
      createdAt: number;
    }
  >();
  private permSeq = 0;
  /** 开着才挂起权限请求（allow/deny）等 UI 决定；关着照旧秒回（默认关，较敏感） */
  interactivePermissions = false;
  /** 开着才挂起 Elicitation（AskUserQuestion）等独立气泡作答；问答无害，默认开 */
  holdElicitation = true;
  /** doctor 用：是否在监听 / 收到事件计数与最近时间（实证 hook 通不通） */
  listening = false;
  eventCount = 0;
  lastEventAt?: number;
  /** 每种 hook 事件最近收到时间，揭示哪些事件没在收 */
  readonly lastByEvent = new Map<string, number>();

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
        // 远程 session 通过 SSH 反向隧道也打到这个端口；hook 命令带 ?remote=<label>
        // 标记来源（本地 hook 不带），用于在地图上区分远程螃蟹
        let remoteSource: string | undefined;
        try {
          remoteSource =
            new URL(req.url ?? '/', 'http://x').searchParams.get('remote') ??
            undefined;
        } catch {
          /* 忽略畸形 URL */
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
          if (ev) {
            if (remoteSource) ev.remoteSource = remoteSource;
            this.eventCount++;
            this.lastEventAt = Date.now();
            this.lastByEvent.set(ev.hook_event_name, this.lastEventAt);
          }

          // 答后即收：这条事件若是「某挂起提示被作答之后才会发生」的活动
          //（工具跑完 / 回合结束 / 用户改敲了新输入），就收掉对应的挂起——
          // 这样你在终端里答的也算数，气泡不再傻等 5 分钟超时。没人答就原样挂着。
          if (ev) this.handleActivity(ev);

          // 挂起等 UI 决定。问答（AskUserQuestion）无害，归「问答气泡」开关 holdElicitation 管；
          // 真权限请求较敏感，归「权限卡」开关 interactivePermissions 管。
          // ⚠️ CC 2.1.185 实测：AskUserQuestion 经 PermissionRequest（载荷带 questions 数组）上来，
          //    不再发 Elicitation——所以「是不是问答」要看载荷，不能只看事件名，否则权限卡默认关时
          //    问答气泡永远不弹（=「气泡没有出现」的根因）。只认问答呈现事件，绝不把 Pre/PostToolUse
          //    （它们 tool_name 也可能是 AskUserQuestion）当问答 hold。
          const isQuestionHook =
            ev?.hook_event_name === 'Elicitation' ||
            (ev?.hook_event_name === 'PermissionRequest' &&
              (ev?.tool_name === 'AskUserQuestion' ||
                Array.isArray(
                  (ev?.tool_input as { questions?: unknown } | undefined)
                    ?.questions,
                )));
          const wantHold =
            ev != null &&
            (isQuestionHook
              ? this.holdElicitation
              : ev.hook_event_name === 'PermissionRequest' &&
                this.interactivePermissions);
          if (ev && wantHold) {
            const id = `perm-${++this.permSeq}-${Date.now()}`;
            const timer = setTimeout(
              () => this.resolvePermission(id, undefined),
              PERMISSION_HOLD_MS,
            );
            this.pending.set(id, {
              res,
              timer,
              eventName: ev.hook_event_name,
              sessionId: ev.session_id,
              agentId: ev.agent_id,
              toolName: ev.tool_name,
              remoteSource: ev.remoteSource,
              toolUseId: (ev as { tool_use_id?: string }).tool_use_id,
              createdAt: Date.now(),
            });
            // 只在响应未正常结束就断开（curl 超时/被杀）时清理；
            // 注意 req 的 close 在请求体读完就会触发，不能用它
            res.on('close', () => {
              if (!res.writableEnded) {
                const p = this.pending.get(id);
                if (p) {
                  clearTimeout(p.timer);
                  this.pending.delete(id);
                  this.emit('resolved', id); // 连接断开 → UI 即时收掉
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
        this.listening = true;
        resolve(true);
      });
    });
  }

  /**
   * UI 的决定写回挂起的 hook 请求；behavior 为空 = 无意见（回落终端提示）。
   * extra 仅对 allow 合并进 decision——Elicitation 用 {updatedInput:{...,answers}}
   * 预填答案；权限"always allow"用 {updatedPermissions:[suggestion]}（机制学 clawd）。
   */
  resolvePermission(
    id: string,
    behavior?: 'allow' | 'deny',
    extra?: Record<string, unknown>,
  ): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    this.emit('resolved', id); // 作答/超时 → UI 即时收掉对应提示
    if (p.res.writableEnded || p.res.destroyed) return false;
    const decision: Record<string, unknown> = {
      behavior,
      ...(behavior === 'allow' && extra ? extra : {}),
    };
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

  /**
   * 收到 hook 事件时判断：它是不是「这个挂起提示对应的那次工具调用刚跑完」（=被答了）？
   * 是 → 把对应挂起按超时口径（无意见 {}）收掉，气泡/行内提示立刻消失。
   * 无论你在 CrabWatch 气泡里答、还是直接在终端里答，AskUserQuestion 答完都会发
   * PostToolUse(AskUserQuestion) → 据此精确收掉；没人答就原样挂着等你答。
   *
   * 只认 PostToolUse / PostToolUseFailure，且要「同 session + 同 agent + 同 remote +
   * 同工具名」（有 tool_use_id 再精确配，否则同名里最早的一个）：subagent 自带 agent_id、
   * 远程自带 remoteSource、并发别的工具 tool_name 不同 → 都不会误收。
   *
   * ⚠️ 绝不能拿 Stop / SessionEnd / UserPromptSubmit 当信号（实测教训）：CC 在「呈现
   *    问答、等你输入」时本身就会发 Stop（呈现约 1 分钟后），那一刻问答还没答、气泡还
   *    该在——用 Stop 收会把正等你作答的气泡提前收掉（用户：人走开回来气泡已没了）。
   *    会话真结束时挂起的 curl 连接会断，由 res.on('close') 兜底收，不靠这里。
   */
  private handleActivity(ev: HookEvent): void {
    if (this.pending.size === 0) return;
    const name = ev.hook_event_name;
    if (name !== 'PostToolUse' && name !== 'PostToolUseFailure') return;
    const cands = [...this.pending].filter(
      ([, p]) =>
        p.sessionId === ev.session_id &&
        p.agentId === ev.agent_id &&
        p.remoteSource === ev.remoteSource &&
        p.toolName === ev.tool_name,
    );
    if (cands.length === 0) return;
    const tuid = (ev as { tool_use_id?: string }).tool_use_id;
    let pick = tuid
      ? cands.find(([, p]) => p.toolUseId && p.toolUseId === tuid)
      : undefined;
    if (!pick) pick = cands.sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (pick) this.resolvePermission(pick[0], undefined);
  }

  stop(): void {
    for (const id of [...this.pending.keys()]) this.resolvePermission(id);
    this.server?.close();
  }
}
