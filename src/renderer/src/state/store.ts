import { create } from 'zustand';
import type { CrabState, ParsedLine } from '../../../shared/types';
import type { EngineEventMessage, InitState } from '../../../shared/ipc';
import { playSound } from '../sound';

export interface CrabUI {
  sessionId: string;
  projectSlug: string;
  projectName: string;
  /** 名牌对应的完整目录（众数 cwd），SessionPanel 展示真实位置 */
  projectPath?: string;
  /** cwd → transcript 行数计票，名牌=众数（粘滞：严格超过才换名） */
  cwdCounts?: Record<string, number>;
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
  /** 短暂的特殊动画（出错/compact），到时自动恢复 */
  flash?: { kind: 'error' | 'compact'; until: number };
  /** 活跃 subagent 数（>0 时工作动画变耍杂技） */
  subagentCount?: number;
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

/**
 * cwd 计票：名牌跟随该 session 的主战目录（众数），而非实时 cwd。
 * 粘滞规则=新目录票数严格超过当前名牌才换名，偶发 cd 不抖动。
 */
function bumpCwd(crab: CrabUI, cwd: string): Partial<CrabUI> {
  const counts = { ...(crab.cwdCounts ?? {}) };
  counts[cwd] = (counts[cwd] ?? 0) + 1;
  let best = crab.projectPath ?? cwd;
  for (const [p, n] of Object.entries(counts))
    if (n > (counts[best] ?? 0)) best = p;
  const name = best.split('/').pop();
  return {
    cwdCounts: counts,
    ...(best !== crab.projectPath && name
      ? { projectPath: best, projectName: name }
      : {}),
  };
}

export interface PendingPerm {
  id: string;
  sessionId?: string;
  toolName: string;
  brief: string;
  /** 完整 tool_input，渲染层按工具类型排版 */
  input: Record<string, unknown>;
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
  /** HUD 下拉（timeline/settings）展开中——roster 隐藏避免被盖出半截行 */
  hudMenuOpen: boolean;
  setHudMenuOpen(on: boolean): void;
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
      projectPath?: string;
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
        projectPath: info.projectPath,
        cwdCounts: info.projectPath ? { [info.projectPath]: 1 } : {},
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
          for (const pl of lines) {
            if (!pl.line.cwd) continue;
            const c = get().crabs[info.sessionId];
            if (c) setCrab(info.sessionId, bumpCwd(c, pl.line.cwd));
          }
          const rev = [...lines].reverse();
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
    // 提示音/弹窗只配两个真信号（学 clawd 的克制）：停下等输入 / 要权限
    const prevCrab = get().crabs[sessionId];
    const prev = prevCrab?.state;
    if (patch.state && prevCrab && prev && patch.state !== prev) {
      const kind =
        patch.state === 'waiting_input' &&
        ['working', 'thinking'].includes(prev)
          ? ('complete' as const)
          : patch.state === 'waiting_permission'
            ? ('confirm' as const)
            : undefined;
      if (kind) {
        playSound(kind);
        // 弹窗：主窗聚焦时你正看着沙滩，不需要
        if (localStorage.getItem('cw-popups') === '1' && !document.hasFocus())
          void window.crabwatch.showPopup(
            prevCrab.projectName,
            kind === 'complete' ? 'waiting for your input' : 'permission request',
          );
      }
    }
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
    hudMenuOpen: false,
    setHudMenuOpen(on) {
      set({ hudMenuOpen: on });
    },

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
                flash: { kind: 'error', until: now + 4000 },
                lastActivity: now,
              });
              break;
            case 'PreCompact':
              setCrab(id, {
                flash: { kind: 'compact', until: now + 6000 },
                bubble: 'compacting…',
                lastActivity: now,
              });
              break;
            case 'SubagentStart':
              setCrab(id, {
                subagentCount: (get().crabs[id]?.subagentCount ?? 0) + 1,
                lastActivity: now,
              });
              break;
            case 'SubagentStop':
              setCrab(id, {
                subagentCount: Math.max(
                  0,
                  (get().crabs[id]?.subagentCount ?? 0) - 1,
                ),
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
                      input,
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
              const c = get().crabs[batch.sessionId];
              if (c) setCrab(batch.sessionId, bumpCwd(c, pl.line.cwd));
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
      // 重复点同一只螃蟹保持现状，别把已加载的消息清掉（effect 不会重跑）
      set((s) =>
        s.selectedId === id ? s : { selectedId: id, recent: [] },
      );
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
