import { create } from 'zustand';
import type { CrabState, ParsedLine } from '../../../shared/types';
import type { EngineEventMessage, InitState } from '../../../shared/ipc';

export interface CrabUI {
  sessionId: string;
  projectSlug: string;
  projectName: string;
  title?: string;
  state: CrabState;
  stateSince: number;
  /** 气泡文字（工具名等），undefined 时按状态画默认气泡 */
  bubble?: string;
  lastActivity: number;
  colorIdx: number;
  /** hover 信息卡数据 */
  model?: string;
  effort?: string;
  version?: string;
  /** 最近一条 assistant 消息的上下文占用（input+cache tokens） */
  ctxTokens?: number;
}

function ctxTokensOf(usage: {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

const SLEEP_AFTER_MS = 5 * 60_000;
const TRANSIENT_MS = 1500; // spawning / exiting 动画时长

export interface PendingPerm {
  id: string;
  sessionId?: string;
  toolName: string;
  brief: string;
  at: number;
}

interface CWStore {
  crabs: Record<string, CrabUI>;
  pendingPerms: PendingPerm[];
  /** projectSlug 首次出现顺序 → 潮池分配 */
  zoneOrder: string[];
  degraded?: string;
  selectedId?: string;
  recent: ParsedLine[];
  /** 审计时间线面板当前打开的项目 */
  timeline?: { slug: string; name: string };
  init(s: InitState): void;
  apply(msg: EngineEventMessage): void;
  select(id?: string): void;
  setRecent(lines: ParsedLine[]): void;
  openTimeline(slug: string, name: string): void;
  closeTimeline(): void;
  removePerm(id: string): void;
  tick(now: number): void;
}

export const useStore = createStore();

// 本地调试钩子（CW_CAPTURE 自验证 & devtools 手动操作用）
(window as unknown as Record<string, unknown>).__cw = useStore;

function createStore() {
  return create<CWStore>((set, get) => {
  function upsertCrab(
    info: {
      sessionId: string;
      projectSlug: string;
      projectName: string;
      title?: string;
      version?: string;
    },
    initialState: CrabState,
  ) {
    let created = false;
    set((s) => {
      if (s.crabs[info.sessionId]) return s;
      created = true;
      const zoneOrder = s.zoneOrder.includes(info.projectSlug)
        ? s.zoneOrder
        : [...s.zoneOrder, info.projectSlug];
      const siblings = Object.keys(s.crabs).length; // 不分区后颜色按全局轮换
      const crab: CrabUI = {
        sessionId: info.sessionId,
        projectSlug: info.projectSlug,
        projectName: info.projectName,
        title: info.title,
        state: initialState,
        stateSince: Date.now(),
        lastActivity: Date.now(),
        colorIdx: siblings % 4,
        version: info.version,
      };
      return { zoneOrder, crabs: { ...s.crabs, [info.sessionId]: crab } };
    });
    if (created) {
      // 回读最近行：实时工作目录（cd 后会变）+ 当前 context 占用 + 模型
      void window.crabwatch
        .getRecent(info.sessionId, 25)
        .then((lines) => {
          const rev = [...lines].reverse();
          const cwd = rev.find((l) => l.line.cwd)?.line.cwd;
          const name = cwd?.split('/').pop();
          if (name) setCrab(info.sessionId, { projectName: name });
          const lastAssistant = rev.find(
            (l) => l.line.kind === 'assistant' && l.line.usage,
          )?.line;
          if (lastAssistant?.kind === 'assistant' && lastAssistant.usage)
            setCrab(info.sessionId, {
              ctxTokens: ctxTokensOf(lastAssistant.usage),
              model: lastAssistant.model,
            });
        })
        .catch(() => {});
    }
  }

  function setCrab(sessionId: string, patch: Partial<CrabUI>) {
    set((s) => {
      const crab = s.crabs[sessionId];
      if (!crab) return s;
      return {
        crabs: {
          ...s.crabs,
          [sessionId]: {
            ...crab,
            ...patch,
            ...(patch.state && patch.state !== crab.state
              ? { stateSince: Date.now() }
              : {}),
          },
        },
      };
    });
  }

  return {
    crabs: {},
    pendingPerms: [],
    zoneOrder: [],
    recent: [],

    init(s) {
      set({ degraded: s.degraded });
      for (const info of s.sessions) upsertCrab(info, 'idle_wander');
    },

    apply(msg) {
      const now = Date.now();
      switch (msg.type) {
        case 'session:appeared':
          upsertCrab(msg.info, 'spawning');
          break;
        case 'session:status': {
          const crab = get().crabs[msg.info.sessionId];
          if (!crab) break;
          if (
            msg.info.status === 'busy' &&
            ['idle_wander', 'sleeping', 'waiting_input'].includes(crab.state)
          )
            setCrab(crab.sessionId, { state: 'working', lastActivity: now });
          else if (
            msg.info.status === 'idle' &&
            ['working', 'thinking'].includes(crab.state)
          )
            setCrab(crab.sessionId, {
              state: 'waiting_input',
              bubble: undefined,
            });
          break;
        }
        case 'session:gone':
          setCrab(msg.info.sessionId, { state: 'exiting', bubble: undefined });
          break;
        case 'hook:event': {
          const ev = msg.ev;
          const id = ev.session_id;
          if (!id || !get().crabs[id]) break;
          const effort = (ev as { effort?: { level?: string } }).effort?.level;
          if (effort) setCrab(id, { effort });
          switch (ev.hook_event_name) {
            case 'UserPromptSubmit':
              setCrab(id, { state: 'thinking', bubble: undefined, lastActivity: now });
              break;
            case 'PreToolUse':
            case 'PostToolUse':
              setCrab(id, {
                state: 'working',
                bubble: ev.tool_name,
                lastActivity: now,
              });
              break;
            case 'PostToolUseFailure':
              setCrab(id, {
                state: 'working',
                bubble: `✗ ${ev.tool_name ?? ''}`,
                lastActivity: now,
              });
              break;
            case 'PermissionRequest': {
              setCrab(id, {
                state: 'waiting_permission',
                bubble: 'permission?',
                lastActivity: now,
              });
              const permId = (ev as { permissionId?: string }).permissionId;
              if (permId) {
                const input = (ev.tool_input ?? {}) as Record<string, unknown>;
                const brief =
                  typeof input.command === 'string'
                    ? input.command.slice(0, 120)
                    : typeof input.file_path === 'string'
                      ? input.file_path
                      : JSON.stringify(input).slice(0, 120);
                set((s) => ({
                  pendingPerms: [
                    ...s.pendingPerms.filter((p) => p.id !== permId),
                    {
                      id: permId,
                      sessionId: id,
                      toolName: ev.tool_name ?? 'tool',
                      brief,
                      at: now,
                    },
                  ].slice(-5),
                }));
              }
              break;
            }
            case 'Notification':
              setCrab(id, { state: 'waiting_permission', lastActivity: now });
              break;
            case 'Stop':
              setCrab(id, {
                state: 'waiting_input',
                bubble: undefined,
                lastActivity: now,
              });
              break;
            case 'SessionEnd':
              setCrab(id, { state: 'exiting', bubble: undefined });
              break;
          }
          break;
        }
        case 'transcript:lines': {
          const { batch } = msg;
          for (const pl of batch.lines) {
            if (pl.line.kind === 'ai-title' && pl.line.title && !batch.agentId)
              setCrab(batch.sessionId, { title: pl.line.title });
            if (pl.line.kind === 'assistant' && !batch.agentId) {
              if (pl.line.model)
                setCrab(batch.sessionId, { model: pl.line.model });
              if (pl.line.usage)
                setCrab(batch.sessionId, {
                  ctxTokens: ctxTokensOf(pl.line.usage),
                });
            }
            if (pl.line.cwd && !batch.agentId) {
              const name = pl.line.cwd.split('/').pop();
              if (name) setCrab(batch.sessionId, { projectName: name });
            }
          }
          const { selectedId, recent } = get();
          if (selectedId === batch.sessionId && !batch.agentId)
            set({ recent: [...recent, ...batch.lines].slice(-300) });
          setCrab(batch.sessionId, { lastActivity: now });
          break;
        }
        case 'engine:degraded':
          set({ degraded: msg.reason });
          break;
      }
    },

    select(id) {
      set({ selectedId: id, recent: [] });
    },
    setRecent(lines) {
      set({ recent: lines });
    },
    openTimeline(slug, name) {
      set({ timeline: { slug, name } });
    },
    closeTimeline() {
      set({ timeline: undefined });
    },
    removePerm(id) {
      set((s) => ({ pendingPerms: s.pendingPerms.filter((p) => p.id !== id) }));
    },

    tick(now) {
      // 过期的权限卡自动消失（server 侧 50s 已自动回「无意见」）
      const { pendingPerms } = get();
      if (pendingPerms.some((p) => now - p.at > 50_000))
        set((s) => ({
          pendingPerms: s.pendingPerms.filter((p) => now - p.at <= 50_000),
        }));
      const { crabs } = get();
      for (const crab of Object.values(crabs)) {
        const inState = now - crab.stateSince;
        if (crab.state === 'spawning' && inState > TRANSIENT_MS)
          setCrab(crab.sessionId, { state: 'idle_wander' });
        else if (crab.state === 'exiting' && inState > TRANSIENT_MS * 2)
          set((s) => {
            const rest = { ...s.crabs };
            delete rest[crab.sessionId];
            return {
              crabs: rest,
              selectedId:
                s.selectedId === crab.sessionId ? undefined : s.selectedId,
            };
          });
        else if (
          ['idle_wander', 'waiting_input'].includes(crab.state) &&
          now - crab.lastActivity > SLEEP_AFTER_MS
        )
          setCrab(crab.sessionId, { state: 'sleeping', bubble: undefined });
      }
    },
  };
  });
}
