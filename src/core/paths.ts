import os from 'node:os';
import path from 'node:path';

export const claudeDir = path.join(os.homedir(), '.claude');
export const sessionsDir = path.join(claudeDir, 'sessions');
export const projectsDir = path.join(claudeDir, 'projects');

/** Claude Code 的项目目录 slug：绝对路径里非字母数字一律换成 - */
export function slugForPath(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, '-');
}

export function transcriptPathFor(cwd: string, sessionId: string): string {
  return path.join(projectsDir, slugForPath(cwd), `${sessionId}.jsonl`);
}

export function subagentsDirFor(cwd: string, sessionId: string): string {
  return path.join(projectsDir, slugForPath(cwd), sessionId, 'subagents');
}
