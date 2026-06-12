import crypto from 'node:crypto';
import path from 'node:path';
import { runClaude } from './summarizer.js';
import { readJsonCache, writeJsonCache } from './cacheStore.js';
import type {
  ProjectTimelineEntry,
  Segment,
  StoryResult,
} from '../shared/types.js';

const MAX_SEGS = 80;

/** 一个 segment 压成 prompt 里的一行事实（确定性，不喂全文防 prompt 失控） */
function segLine(sessionShort: string, seg: Segment): string {
  const t = seg.startedAt ? seg.startedAt.slice(5, 16).replace('T', ' ') : '?';
  const parts = [`[${t} · ${sessionShort}] req: "${seg.promptFull.slice(0, 160).replace(/\s+/g, ' ')}"`];
  if (seg.filesEdited.length)
    parts.push(
      `files: ${seg.filesEdited
        .slice(0, 6)
        .map((f) => path.basename(f))
        .join(', ')}${seg.filesEdited.length > 6 ? ` +${seg.filesEdited.length - 6}` : ''}`,
    );
  const tests = seg.commands.filter((c) => c.kind === 'test');
  if (seg.commands.length)
    parts.push(
      `cmds: ${seg.commands.length}${tests.length ? ` (tests ${tests.every((c) => c.ok !== false) ? 'pass' : 'FAIL'})` : ''}`,
    );
  if (seg.commits.length)
    parts.push(`commits: ${seg.commits.map((c) => `"${c.message.slice(0, 60)}"`).join('; ')}`);
  if (seg.subagents.length) parts.push(`subagents: ${seg.subagents.length}`);
  if (seg.assistantGist)
    parts.push(`outcome: ${seg.assistantGist.slice(0, 140).replace(/\s+/g, ' ')}`);
  parts.push(`${(seg.durationMs / 60000).toFixed(0)}m`);
  return parts.join(' | ');
}

function buildPrompt(
  projectName: string,
  lines: string[],
  omitted: number,
): string {
  return [
    `You are writing a "while you were away" recap for a developer, covering their recent Claude Code (terminal AI coding agent) sessions on the project "${projectName}". Below is a chronological log of work segments (each = one user request → what the agent did).`,
    '',
    'Write an engaging, readable story in markdown:',
    '- Start with **TL;DR** — 2-3 plain sentences: what got done overall.',
    '- Then 2-5 chapters with `###` headings named by task or theme. Narrate each as a story: the goal, the attempts, obstacles hit, and how they were resolved — with a sense of time passing. Be concrete and stay truthful to the log; never invent details.',
    '- Bold key file and feature names. The first time any technical term appears (jargon, tool names, acronyms), add a brief parenthetical explanation a tired reader would thank you for.',
    '- End with **### Loose ends** — unfinished work, failing commands, anything that needs attention.',
    'Total ~400 words. No preamble before the TL;DR.',
    '',
    `--- WORK LOG (${lines.length} segments${omitted > 0 ? `, ${omitted} earlier omitted` : ''}) ---`,
    ...lines,
  ].join('\n');
}

/** 故事线审计报告：跨 session 串成叙事，按内容指纹缓存 */
export class Storyteller {
  private inflight = new Map<string, Promise<StoryResult>>();

  constructor(private cacheDir: string) {}

  async tell(
    entries: ProjectTimelineEntry[],
    projectName: string,
    sinceTs: string,
    force: boolean,
  ): Promise<StoryResult> {
    const picked: { sessionShort: string; seg: Segment }[] = [];
    for (const e of entries)
      for (const seg of e.segments)
        if (!seg.startedAt || seg.startedAt >= sinceTs)
          picked.push({ sessionShort: e.sessionId.slice(0, 6), seg });
    picked.sort((a, b) =>
      (a.seg.startedAt ?? '').localeCompare(b.seg.startedAt ?? ''),
    );
    const omitted = Math.max(0, picked.length - MAX_SEGS);
    const used = picked.slice(-MAX_SEGS);
    const sessionCount = new Set(used.map((p) => p.sessionShort)).size;

    if (used.length === 0)
      return {
        text: '_no activity in this window_',
        segCount: 0,
        sessionCount: 0,
        sinceTs,
        generatedAt: Date.now(),
        cached: false,
      };

    const hash = crypto
      .createHash('sha256')
      .update('v2:' + used.map((p) => p.seg.hash).join(','))
      .digest('hex')
      .slice(0, 24);

    if (!force) {
      const cached = await readJsonCache<StoryResult>(
        this.cacheDir,
        'stories',
        hash,
      );
      if (cached?.text) return { ...cached, cached: true };
    }

    // 同 key 并发去重（双击 regenerate / 视图反复进入）
    const existing = this.inflight.get(hash);
    if (existing && !force) return existing;

    const run = (async (): Promise<StoryResult> => {
      const lines = used.map((p) => segLine(p.sessionShort, p.seg));
      const text = await runClaude(
        buildPrompt(projectName, lines, omitted),
        'claude-haiku-4-5',
        120_000,
      );
      const result: StoryResult = {
        text,
        segCount: used.length,
        sessionCount,
        sinceTs,
        generatedAt: Date.now(),
        cached: false,
      };
      if (text)
        await writeJsonCache(this.cacheDir, 'stories', hash, result);
      return result;
    })();
    this.inflight.set(hash, run);
    try {
      return await run;
    } finally {
      this.inflight.delete(hash);
    }
  }
}
