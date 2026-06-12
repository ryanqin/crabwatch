import type {
  HookEvent,
  OrganizeResult,
  ParsedLine,
  ProjectListing,
  ProjectTimelineEntry,
  Segment,
  SessionInfo,
  TranscriptBatch,
  UsageSnapshot,
} from './types.js';

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
  ): Promise<string>;
  summarize(seg: Segment, projectName: string): Promise<string>;
  organize(slug: string, cachedOnly: boolean): Promise<OrganizeResult>;
  getUsage(): Promise<UsageSnapshot | null>;
  getAutoLaunch(): Promise<{ enabled: boolean; packaged: boolean }>;
  setAutoLaunch(on: boolean): Promise<{ enabled: boolean; packaged: boolean }>;
  onEngineEvent(cb: (ev: EngineEventMessage) => void): () => void;
}
