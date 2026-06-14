import type {
  HookEvent,
  OrganizeResult,
  ParsedLine,
  ProjectListing,
  ProjectTimelineEntry,
  Segment,
  SessionInfo,
  StoryResult,
  TranscriptBatch,
  UsageSnapshot,
} from './types.js';
import type { DoctorReport } from '../core/doctor.js';

export type { DoctorReport };

/** main → renderer 单向推送（webContents.send('engine-event', ev)） */
export type EngineEventMessage =
  | { type: 'session:appeared'; info: SessionInfo }
  | { type: 'session:status'; info: SessionInfo; prevStatus?: string }
  | { type: 'session:gone'; info: SessionInfo }
  | { type: 'transcript:lines'; batch: TranscriptBatch }
  | { type: 'hook:event'; ev: HookEvent }
  | { type: 'engine:degraded'; reason: string }
  | { type: 'organize:progress'; done: number; total: number };

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
  showPopup(title: string, body: string): Promise<void>;
  story(
    slug: string,
    projectName: string,
    sinceTs: string,
    force: boolean,
  ): Promise<StoryResult>;
  runDoctor(): Promise<DoctorReport>;
  reinstallHooks(): Promise<Record<string, string>>;
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
