import fsp from 'node:fs/promises';
import path from 'node:path';
import { projectsDir } from '../paths.js';
import { TranscriptTail } from '../transcriptReader.js';
import { extractSegments } from './extractor.js';
import { readJsonCache, writeJsonCache } from '../cacheStore.js';
import type {
  ProjectListing,
  ProjectTimelineEntry,
  SessionAudit,
} from '../../shared/types.js';

const RELAY_GAP_MS = 24 * 3600_000;

/** 扫描全部项目 slug（HUD 项目选择器用）。name 取最新 jsonl 首行的 cwd basename。 */
export async function listProjects(
  liveSlugs: Set<string>,
): Promise<ProjectListing[]> {
  let slugs: string[] = [];
  try {
    slugs = await fsp.readdir(projectsDir);
  } catch {
    return [];
  }
  const out: ProjectListing[] = [];
  for (const slug of slugs) {
    if (slug.includes('-crabwatch-headless')) continue; // 自家摘要器的 headless 调用
    const dir = path.join(projectsDir, slug);
    let files: string[];
    try {
      files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    if (files.length === 0) continue;
    let lastActive = 0;
    let newest = '';
    for (const f of files) {
      try {
        const st = await fsp.stat(path.join(dir, f));
        if (st.mtimeMs > lastActive) {
          lastActive = st.mtimeMs;
          newest = f;
        }
      } catch {
        /* ignore */
      }
    }
    let name = slug.split('-').filter(Boolean).pop() ?? slug;
    try {
      // 读最新文件首块，找带 cwd 的行
      const fh = await fsp.open(path.join(dir, newest), 'r');
      const buf = Buffer.alloc(16 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      const m = buf
        .subarray(0, bytesRead)
        .toString('utf8')
        .match(/"cwd":"([^"]+)"/);
      if (m) name = path.basename(m[1]);
    } catch {
      /* fallback 已有 */
    }
    out.push({
      slug,
      name,
      sessionCount: files.length,
      lastActive,
      isLive: liveSlugs.has(slug),
    });
  }
  return out.sort(
    (a, b) => Number(b.isLive) - Number(a.isLive) || b.lastActive - a.lastActive,
  );
}

/** 单个 session 的审计（fileSize 相同→缓存命中；变了→全量重算，正确性优先） */
export async function buildSessionAudit(
  transcriptPath: string,
  sessionId: string,
  cacheDir: string,
): Promise<SessionAudit | undefined> {
  let size: number;
  try {
    size = (await fsp.stat(transcriptPath)).size;
  } catch {
    return undefined;
  }
  const cached = await readJsonCache<SessionAudit>(cacheDir, 'audit', sessionId);
  if (cached && cached.fileSize === size && cached.transcriptPath === transcriptPath)
    return cached;

  const tail = new TranscriptTail(transcriptPath);
  const lines = await tail.readNew();
  const { segments, title, firstTs, lastTs } = extractSegments(lines, sessionId);
  const audit: SessionAudit = {
    sessionId,
    transcriptPath,
    title,
    firstTs,
    lastTs,
    fileSize: size,
    segments,
  };
  await writeJsonCache(cacheDir, 'audit', sessionId, audit);
  return audit;
}

/** 项目级时间线：session 按时间串联 + 接力标记 */
export async function buildProjectTimeline(
  slug: string,
  cacheDir: string,
): Promise<ProjectTimelineEntry[]> {
  const dir = path.join(projectsDir, slug);
  let files: string[];
  try {
    files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const audits: SessionAudit[] = [];
  for (const f of files) {
    const sessionId = f.replace(/\.jsonl$/, '');
    const audit = await buildSessionAudit(path.join(dir, f), sessionId, cacheDir);
    if (audit && (audit.segments.length > 0 || audit.title)) audits.push(audit);
  }
  audits.sort((a, b) => (a.firstTs ?? '').localeCompare(b.firstTs ?? ''));
  return audits.map((a, i) => {
    const prev = audits[i - 1];
    const gap =
      prev?.lastTs && a.firstTs
        ? new Date(a.firstTs).getTime() - new Date(prev.lastTs).getTime()
        : Infinity;
    return { ...a, relayFromPrev: gap < RELAY_GAP_MS };
  });
}

/** 原文跳转：读 transcript 的一个 byte 区间（限制在 projectsDir 内防越权） */
export async function readRawRange(
  transcriptPath: string,
  byteStart: number,
  byteEnd: number,
  maxBytes = 2 * 1024 * 1024,
): Promise<string> {
  const resolved = path.resolve(transcriptPath);
  if (!resolved.startsWith(projectsDir + path.sep))
    throw new Error('path outside projects dir');
  const len = Math.min(byteEnd - byteStart + 1, maxBytes);
  const fh = await fsp.open(resolved, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, byteStart);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}
