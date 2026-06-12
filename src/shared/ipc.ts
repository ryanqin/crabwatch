import type {
  HookEvent,
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
  | { type: 'engine:degraded'; reason: string };

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
  getUsage(): Promise<UsageSnapshot | null>;
  onEngineEvent(cb: (ev: EngineEventMessage) => void): () => void;
}
