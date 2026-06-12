import { createHash } from 'node:crypto';
import path from 'node:path';
import { runClaude } from './summarizer.js';
import { readJsonCache, writeJsonCache } from './cacheStore.js';
import type {
  OrganizeResult,
  ProjectTimelineEntry,
  SessionName,
  TaskCluster,
} from '../shared/types.js';

const BATCH = 8;
/** session 比命名时多出这么多 segment 就允许重命名 */
const RENAME_GROWTH = 6;

function parseJsonLoose(s: string): unknown {
  const m = s.match(/\[[\s\S]*\]/);
  return JSON.parse(m ? m[0] : s);
}

const GENERIC_DIRS = new Set([
  'Users', 'home', 'src', 'lib', 'dist', 'out', 'app', 'components',
  'core', 'scripts', 'tests', 'test', 'assets', 'public', 'node_modules',
]);

function dirParts(e: ProjectTimelineEntry): Set<string> {
  const parts = new Set<string>();
  for (const seg of e.segments)
    for (const f of seg.filesEdited)
      for (const part of path.dirname(f).split('/'))
        if (part.length >= 3 && !GENERIC_DIRS.has(part)) parts.add(part);
  return parts;
}

/**
 * 在过半 session 里都出现的目录名（家目录、工作区根）没有区分度，按文档频率剔除——
 * 剩下的高频目录名往往就是项目/仓库名。
 */
function computeStopDirs(entries: ProjectTimelineEntry[]): Set<string> {
  const df = new Map<string, number>();
  let n = 0;
  for (const e of entries) {
    const parts = dirParts(e);
    if (parts.size === 0) continue;
    n++;
    for (const p of parts) df.set(p, (df.get(p) ?? 0) + 1);
  }
  const stop = new Set(GENERIC_DIRS);
  for (const [p, c] of df) if (c >= Math.max(2, n * 0.5)) stop.add(p);
  return stop;
}

/** 改动文件路径里最高频的有区分度目录名——往往就是项目/仓库名 */
function topDirs(e: ProjectTimelineEntry, stopDirs: Set<string>): string[] {
  const counts = new Map<string, number>();
  for (const seg of e.segments)
    for (const f of seg.filesEdited)
      for (const part of path.dirname(f).split('/'))
        if (part.length >= 3 && !stopDirs.has(part))
          counts.set(part, (counts.get(part) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);
}

function sessionFacts(e: ProjectTimelineEntry, stopDirs: Set<string>): string {
  const prompts = [...e.segments.slice(0, 3), ...e.segments.slice(-2)]
    .map((s) => s.promptPreview.slice(0, 70))
    .filter(Boolean);
  const files = [
    ...new Set(
      e.segments.flatMap((s) => s.filesEdited.map((f) => path.basename(f))),
    ),
  ].slice(0, 6);
  const dirs = topDirs(e, stopDirs);
  return [
    `- id: ${e.sessionId.slice(0, 8)}`,
    `  date: ${e.firstTs?.slice(0, 10) ?? '?'}`,
    e.title ? `  existing-title: ${e.title.slice(0, 60)}` : undefined,
    `  prompts: ${prompts.join(' / ')}`,
    dirs.length ? `  dirs: ${dirs.join(', ')}` : undefined,
    files.length ? `  files: ${files.join(', ')}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

/** 批量给 session 起名（Haiku，8 个一批，一次调用），按 sessionId 永久缓存 */
export async function nameSessions(
  entries: ProjectTimelineEntry[],
  cacheDir: string,
  onProgress?: (done: number, total: number) => void,
  stopDirs: Set<string> = GENERIC_DIRS,
): Promise<Record<string, SessionName>> {
  const names: Record<string, SessionName> = {};
  const pending: ProjectTimelineEntry[] = [];
  for (const e of entries) {
    const cached = await readJsonCache<SessionName>(cacheDir, 'names', e.sessionId);
    if (cached && e.segments.length - cached.segCount < RENAME_GROWTH) {
      names[e.sessionId] = cached;
    } else {
      pending.push(e);
    }
  }
  const total = pending.length;
  let done = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    const idMap = new Map(chunk.map((e) => [e.sessionId.slice(0, 8), e]));
    const prompt = [
      'Below are coding sessions from one project. For EACH session, write a concise 4-8 word English title describing what was actually worked on, plus 1-3 lowercase topic keywords.',
      'Reply with ONLY a JSON array, no other text: [{"id": "<id>", "title": "...", "keywords": ["..."]}]',
      '',
      ...chunk.map((e) => sessionFacts(e, stopDirs)),
    ].join('\n');
    try {
      const out = await runClaude(prompt, 'claude-haiku-4-5', 120_000);
      const arr = parseJsonLoose(out) as {
        id?: string;
        title?: string;
        keywords?: string[];
      }[];
      for (const item of arr) {
        const entry = item.id ? idMap.get(item.id) : undefined;
        if (!entry || !item.title) continue;
        const name: SessionName = {
          sessionId: entry.sessionId,
          title: String(item.title).slice(0, 80),
          keywords: (item.keywords ?? []).map(String).slice(0, 3),
          segCount: entry.segments.length,
        };
        names[entry.sessionId] = name;
        await writeJsonCache(cacheDir, 'names', entry.sessionId, name);
      }
    } catch {
      // 这一批失败不阻塞其余批次
    }
    done += chunk.length;
    onProgress?.(done, total);
  }
  return names;
}

/** 任务相关性聚类（Sonnet 一次调用），按 session 集合指纹缓存 + latest 快照 */
export async function clusterSessions(
  entries: ProjectTimelineEntry[],
  names: Record<string, SessionName>,
  cacheDir: string,
  slug: string,
  stopDirs: Set<string> = GENERIC_DIRS,
): Promise<TaskCluster[]> {
  const items = entries.map((e) => ({
    id: e.sessionId.slice(0, 8),
    full: e.sessionId,
    title: names[e.sessionId]?.title ?? e.title ?? '(untitled)',
    keywords: names[e.sessionId]?.keywords ?? [],
    dirs: topDirs(e, stopDirs),
  }));
  const fingerprint = createHash('sha1')
    .update(items.map((i) => i.id + i.title).sort().join('|'))
    .digest('hex')
    .slice(0, 16);
  const cacheKey = `cluster-${slug}`;
  const cached = await readJsonCache<{ fingerprint: string; clusters: TaskCluster[] }>(
    cacheDir,
    'clusters',
    cacheKey,
  );
  if (cached && cached.fingerprint === fingerprint) return cached.clusters;

  const prompt = [
    'Group these coding sessions into task clusters by topical relatedness (same feature, same project area, same kind of work).',
    'Use between 3 and 10 clusters. Short 2-4 word task names. Every session id must appear in exactly one cluster.',
    'Each session lists `dirs` = the directory names it edited files in — these are usually project/repo names. If a session\'s dirs clearly identify a project, its cluster MUST be named after that project (even a cluster of one), never "Misc". Reserve "Misc" only for sessions with no identifiable project.',
    'Reply with ONLY a JSON array, no other text: [{"task": "...", "ids": ["<id>", ...]}]',
    '',
    JSON.stringify(
      items.map(({ id, title, keywords, dirs }) => ({ id, title, keywords, dirs })),
    ),
  ].join('\n');
  const out = await runClaude(prompt, 'claude-sonnet-4-6', 180_000);
  const arr = parseJsonLoose(out) as { task?: string; ids?: string[] }[];

  const byShort = new Map(items.map((i) => [i.id, i.full]));
  const seen = new Set<string>();
  const clusters: TaskCluster[] = [];
  for (const c of arr) {
    if (!c.task || !Array.isArray(c.ids)) continue;
    const ids = c.ids
      .map((id) => byShort.get(String(id)))
      .filter((x): x is string => Boolean(x) && !seen.has(x!));
    ids.forEach((x) => seen.add(x));
    if (ids.length) clusters.push({ task: String(c.task).slice(0, 50), sessionIds: ids });
  }
  const missed = items.filter((i) => !seen.has(i.full)).map((i) => i.full);
  if (missed.length) clusters.push({ task: 'Other', sessionIds: missed });

  await writeJsonCache(cacheDir, 'clusters', cacheKey, { fingerprint, clusters });
  return clusters;
}

/** cachedOnly=true 只读缓存（打开时间线时即时回填）；false 跑 LLM 全量整理 */
export async function organize(
  entries: ProjectTimelineEntry[],
  cacheDir: string,
  slug: string,
  cachedOnly: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<OrganizeResult> {
  if (cachedOnly) {
    const names: Record<string, SessionName> = {};
    for (const e of entries) {
      const n = await readJsonCache<SessionName>(cacheDir, 'names', e.sessionId);
      if (n) names[e.sessionId] = n;
    }
    const cached = await readJsonCache<{ clusters: TaskCluster[] }>(
      cacheDir,
      'clusters',
      `cluster-${slug}`,
    );
    return { names, clusters: cached?.clusters ?? [] };
  }
  const stopDirs = computeStopDirs(entries);
  const names = await nameSessions(entries, cacheDir, onProgress, stopDirs);
  const clusters = await clusterSessions(entries, names, cacheDir, slug, stopDirs);
  return { names, clusters };
}
