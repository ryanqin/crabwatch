import type {
  HookEvent,
  OrganizeResult,
  ParsedLine,
  PendingPrompt,
  ProjectListing,
  ProjectTimelineEntry,
  Segment,
  SessionInfo,
  StoryResult,
  TranscriptBatch,
  UsageSnapshot,
} from './types.js';
import type { DoctorReport } from '../core/doctor.js';
import type { RemoteProfile, RemoteState } from '../core/remoteManager.js';
import type { SendResult } from '../main/sendMessage.js';

export type { DoctorReport, RemoteProfile, RemoteState, SendResult };

/** main → renderer 单向推送（webContents.send('engine-event', ev)） */
export type EngineEventMessage =
  | { type: 'session:appeared'; info: SessionInfo }
  | { type: 'session:status'; info: SessionInfo; prevStatus?: string }
  | { type: 'session:gone'; info: SessionInfo }
  | { type: 'transcript:lines'; batch: TranscriptBatch }
  | { type: 'hook:event'; ev: HookEvent }
  | { type: 'engine:degraded'; reason: string }
  | { type: 'organize:progress'; done: number; total: number }
  | { type: 'remote:state'; state: RemoteState }
  // 行内提示：floating roster 可见时，权限/计划/问答就地展开在对应 session 行下（不再独立气泡）
  | { type: 'prompt:show'; prompt: PendingPrompt }
  | { type: 'prompt:close'; permId: string };

export interface InitState {
  sessions: SessionInfo[];
  degraded?: string;
}

/** preload 暴露给 renderer 的桥 */
export interface CrabwatchBridge {
  init(): Promise<InitState>;
  getRecent(sessionId: string, n: number): Promise<ParsedLine[]>;
  listProjects(): Promise<ProjectListing[]>;
  getTimeline(slug: string): Promise<ProjectTimelineEntry[]>;
  getRaw(
    transcriptPath: string,
    byteStart: number,
    byteEnd: number,
  ): Promise<{ text: string; lines: ParsedLine[] }>;
  summarize(seg: Segment, projectName: string): Promise<string>;
  organize(slug: string, cachedOnly: boolean): Promise<OrganizeResult>;
  getUsage(): Promise<UsageSnapshot | null>;
  getAutoLaunch(): Promise<{ enabled: boolean; packaged: boolean }>;
  setAutoLaunch(on: boolean): Promise<{ enabled: boolean; packaged: boolean }>;
  setPermissionCards(on: boolean): Promise<void>;
  setQuestionBubble(on: boolean): Promise<void>;
  focusTerminal(sessionId: string): Promise<boolean>;
  /** 把一段文字发到该 session 的终端（聚焦+剪贴板粘贴+回车，带前台校验护栏）。submit 默认 true */
  sendToSession(
    sessionId: string,
    text: string,
    submit?: boolean,
  ): Promise<SendResult>;
  /** 略缩悬浮 roster 窗：开关 / 读当前可见性 */
  setFloating(on: boolean): Promise<boolean>;
  getFloating(): Promise<boolean>;
  /** 悬浮窗点行 → 展开主窗并选中该 session；不传 sessionId（点头部/蟹）则只把主窗带到前台 */
  openMain(sessionId?: string): Promise<void>;
  /** 白天/黑夜主题：取当前 resolved 明暗 / 取偏好 / 设偏好（system 跟随 macOS）/ 订阅明暗变化 */
  getTheme(): Promise<'light' | 'dark'>;
  getThemePref(): Promise<'system' | 'light' | 'dark'>;
  setTheme(pref: 'system' | 'light' | 'dark'): Promise<'light' | 'dark'>;
  onTheme(cb: (t: 'light' | 'dark') => void): () => void;
  /** 悬浮窗 renderer 量出内容高度回传，main 调窗口高度跟随 */
  reportFloatingHeight(height: number): void;
  /** 主窗订阅：悬浮窗请求聚焦某 session */
  onFocusSession(cb: (sessionId: string) => void): () => void;
  showPopup(title: string, body: string): Promise<void>;
  /** 气泡 renderer 量出真实高度回传，main 调窗口跟随（自适应高度，不靠内滚） */
  reportBubbleHeight(permId: string, height: number): void;
  story(
    slug: string,
    projectName: string,
    sinceTs: string,
    force: boolean,
  ): Promise<StoryResult>;
  runDoctor(): Promise<DoctorReport>;
  reinstallHooks(): Promise<Record<string, string>>;
  remoteList(): Promise<{ profiles: RemoteProfile[]; states: RemoteState[] }>;
  remoteUpsert(p: RemoteProfile): Promise<RemoteProfile[]>;
  remoteRemove(id: string): Promise<RemoteProfile[]>;
  remoteConnect(id: string): Promise<void>;
  remoteDisconnect(id: string): Promise<void>;
  remoteDeploy(id: string): Promise<string>;
  /**
   * behavior 省略 = 无意见（返回 {} 让 Claude Code 回落终端，to-terminal 用）。
   * extra 仅对 allow 合并进 decision：{updatedInput} 预填问答答案 / {updatedPermissions} always-allow。
   */
  respondPermission(
    id: string,
    behavior?: 'allow' | 'deny',
    extra?: Record<string, unknown>,
  ): Promise<boolean>;
  onEngineEvent(cb: (ev: EngineEventMessage) => void): () => void;
}
