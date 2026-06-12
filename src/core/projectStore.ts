import path from 'node:path';
import { slugForPath, transcriptPathFor } from './paths.js';
import type {
  LiveSessionFile,
  ProjectState,
  SessionInfo,
} from '../shared/types.js';

/** 按项目聚合 session 的内存模型（纯状态，不做 IO） */
export class ProjectStore {
  readonly projects = new Map<string, ProjectState>();
  private bySessionId = new Map<string, SessionInfo>();

  upsertLiveSession(live: LiveSessionFile): SessionInfo {
    const slug = slugForPath(live.cwd);
    let project = this.projects.get(slug);
    if (!project) {
      project = {
        slug,
        path: live.cwd,
        name: path.basename(live.cwd),
        sessions: new Map(),
      };
      this.projects.set(slug, project);
    }
    let info = this.bySessionId.get(live.sessionId);
    if (!info) {
      info = {
        sessionId: live.sessionId,
        projectSlug: slug,
        projectPath: live.cwd,
        projectName: project.name,
        transcriptPath: transcriptPathFor(live.cwd, live.sessionId),
        isLive: true,
        pid: live.pid,
        status: live.status,
        version: live.version,
      };
      this.bySessionId.set(live.sessionId, info);
      project.sessions.set(live.sessionId, info);
    } else {
      info.isLive = true;
      info.pid = live.pid;
      info.status = live.status;
      info.version = live.version ?? info.version;
    }
    return info;
  }

  markGone(live: LiveSessionFile): SessionInfo | undefined {
    const info = this.bySessionId.get(live.sessionId);
    if (info) {
      info.isLive = false;
      info.status = undefined;
      info.pid = undefined;
    }
    return info;
  }

  setTitle(sessionId: string, title: string): void {
    const info = this.bySessionId.get(sessionId);
    if (info) info.title = title;
  }

  get(sessionId: string): SessionInfo | undefined {
    return this.bySessionId.get(sessionId);
  }

  all(): SessionInfo[] {
    return [...this.bySessionId.values()];
  }
}
