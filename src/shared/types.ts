// ── 数据源类型 ────────────────────────────────────────────────────────────────

/** ~/.claude/sessions/{PID}.json — 一个活跃的 Claude Code 进程 */
export interface LiveSessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  status: 'busy' | 'idle' | string;
  kind: 'interactive' | 'background' | string;
  startedAt: number;
  updatedAt: number;
  version?: string;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// transcript JSONL 没有官方 schema 保证：解析统一走判别联合，未知类型归 unknown
export type TranscriptLine =
  | UserLine
  | AssistantLine
  | SystemLine
  | AiTitleLine
  | UnknownLine;

export interface LineBase {
  rawType: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  agentId?: string;
  isSidechain?: boolean;
}

export interface UserLine extends LineBase {
  kind: 'user';
  text: string;
  /** tool_result 载体 / 本地命令回显 / system-reminder 等非真实用户输入 */
  isMeta: boolean;
  toolResults: { toolUseId: string; isError: boolean }[];
}

export interface AssistantLine extends LineBase {
  kind: 'assistant';
  model?: string;
  usage?: TokenUsage;
  text: string;
  toolUses: { id: string; name: string; input: unknown }[];
}

export interface SystemLine extends LineBase {
  kind: 'system';
  subtype?: string;
  durationMs?: number;
}

export interface AiTitleLine extends LineBase {
  kind: 'ai-title';
  title: string;
}

export interface UnknownLine extends LineBase {
  kind: 'unknown';
}

/** 一条解析后的 transcript 行 + 它在文件里的位置（审计原文跳转的锚点） */
export interface ParsedLine {
  lineNo: number;
  byteStart: number;
  byteEnd: number;
  line: TranscriptLine;
}

// ── 领域模型 ────────────────────────────────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  projectSlug: string;
  projectPath: string;
  projectName: string;
  transcriptPath: string;
  title?: string;
  isLive: boolean;
  pid?: number;
  status?: string;
}

export interface ProjectState {
  slug: string;
  path: string;
  name: string;
  sessions: Map<string, SessionInfo>;
}

export type CrabState =
  | 'spawning'
  | 'idle_wander'
  | 'thinking'
  | 'working'
  | 'waiting_input'
  | 'waiting_permission'
  | 'sleeping'
  | 'exiting';

// ── 审计 ────────────────────────────────────────────────────────────────────

export type CommandKind = 'test' | 'build' | 'git' | 'install' | 'other';

/** 一段工作 = 一条真实 user prompt 到下一条之间，全部确定性提取 */
export interface Segment {
  id: string;
  /** 内容指纹，LLM 摘要缓存的 key */
  hash: string;
  promptPreview: string;
  promptFull: string;
  assistantGist: string;
  filesEdited: string[];
  filesReadCount: number;
  commands: { cmd: string; kind: CommandKind; ok: boolean | null }[];
  commits: { message: string }[];
  subagents: { agentType: string; description: string }[];
  tokens: { input: number; output: number; cacheRead: number };
  durationMs: number;
  models: string[];
  lineRange: [number, number];
  byteRange: [number, number];
  startedAt?: string;
  endedAt?: string;
}

export interface SessionAudit {
  sessionId: string;
  transcriptPath: string;
  title?: string;
  firstTs?: string;
  lastTs?: string;
  fileSize: number;
  segments: Segment[];
}

export interface ProjectTimelineEntry extends SessionAudit {
  /** 与上一个 session 间隔 < 24h，视为同一任务流的接力 */
  relayFromPrev: boolean;
}

export interface ProjectListing {
  slug: string;
  name: string;
  sessionCount: number;
  lastActive: number; // 最新 jsonl mtime (ms)
  isLive: boolean;
}

// ── Usage ───────────────────────────────────────────────────────────────────

export interface UsageSnapshot {
  fiveHourPct: number;
  weeklyPct: number;
  fiveHourResetAt?: string;
  weeklyResetAt?: string;
  planName?: string;
  source: 'oauth-api' | 'claude-hud-cache';
  fetchedAt: number;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Claude Code hook POST 过来的 payload（字段随事件类型增减） */
export interface HookEvent {
  hook_event_name: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
  agent_id?: string;
  agent_type?: string;
  [k: string]: unknown;
}

// ── Engine 事件 ──────────────────────────────────────────────────────────────

export interface TranscriptBatch {
  sessionId: string;
  projectSlug: string;
  /** 主 session 为 undefined；subagent 行带 agentId */
  agentId?: string;
  lines: ParsedLine[];
}

export interface EngineEvents {
  'session:appeared': (info: SessionInfo) => void;
  'session:status': (info: SessionInfo, prevStatus: string | undefined) => void;
  'session:gone': (info: SessionInfo) => void;
  'transcript:lines': (batch: TranscriptBatch) => void;
  'hook:event': (ev: HookEvent) => void;
  /** hook server 没起来等降级情况：功能仍可用但退回轮询节奏 */
  'engine:degraded': (reason: string) => void;
  'engine:error': (err: Error) => void;
}
