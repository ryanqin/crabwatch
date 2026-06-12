/**
 * Phase 0/1 的无 UI 验证入口。
 *   npm run cli watch              实时打印 session 出现/状态翻转/新消息
 *   npm run cli canary [filter]    全量扫描 transcripts，输出行类型统计（schema 基线）
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createEngine } from '../src/core/index.js';
import { TranscriptTail } from '../src/core/transcriptReader.js';
import { projectsDir } from '../src/core/paths.js';
import type { ParsedLine, SessionInfo } from '../src/shared/types.js';

const cmd = process.argv[2] ?? 'watch';

function short(id: string): string {
  return id.slice(0, 8);
}

function trunc(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n) + '…' : oneLine;
}

function toolBrief(input: unknown): string {
  if (input && typeof input === 'object') {
    const i = input as Record<string, unknown>;
    if (typeof i.file_path === 'string') return path.basename(i.file_path);
    if (typeof i.command === 'string') return trunc(i.command, 60);
    if (typeof i.pattern === 'string') return trunc(i.pattern, 40);
    if (typeof i.description === 'string') return trunc(i.description, 40);
  }
  return '';
}

function tag(info: SessionInfo, agentId?: string): string {
  const agent = agentId ? `·agent:${agentId.slice(0, 6)}` : '';
  return `[${info.projectName}·${short(info.sessionId)}${agent}]`;
}

function printLines(info: SessionInfo, lines: ParsedLine[], agentId?: string) {
  for (const { line } of lines) {
    const t = tag(info, agentId);
    switch (line.kind) {
      case 'user':
        if (!line.isMeta && line.text)
          console.log(`${t} 💬 user: ${trunc(line.text, 90)}`);
        else if (line.toolResults.length > 0)
          for (const r of line.toolResults)
            console.log(`${t} ↩︎  result ${r.isError ? '✗ error' : '✓ ok'}`);
        break;
      case 'assistant':
        for (const tu of line.toolUses)
          console.log(`${t} 🔧 ${tu.name} ${toolBrief(tu.input)}`);
        if (line.text) console.log(`${t} 🤖 ${trunc(line.text, 90)}`);
        break;
      case 'system':
        if (line.subtype === 'turn_duration')
          console.log(
            `${t} ⏱  turn ${line.durationMs ? (line.durationMs / 1000).toFixed(1) + 's' : 'done'}`,
          );
        break;
      case 'ai-title':
        console.log(`${t} 📌 title: ${line.title}`);
        break;
      case 'unknown':
        break; // watch 模式不噪音化未知行，canary 负责统计
    }
  }
}

async function watch() {
  const engine = createEngine({ tailFromStart: false });
  engine.on('session:appeared', (info) => {
    console.log(
      `\n[appeared] pid=${info.pid} project=${info.projectName} status=${info.status} session=${short(info.sessionId)}`,
    );
  });
  engine.on('session:status', (info, prev) => {
    console.log(
      `[status] ${tag(info)} ${prev ?? '?'} → ${info.status}`,
    );
  });
  engine.on('session:gone', (info) => {
    console.log(`[gone] ${tag(info)} pid=${info.pid ?? '?'}`);
  });
  engine.on('transcript:lines', ({ sessionId, agentId, lines }) => {
    const info = engine.store.get(sessionId);
    if (info) printLines(info, lines, agentId);
  });
  engine.on('engine:error', (err) => {
    console.error(`[error] ${err.message}`);
  });
  await engine.start();
  console.log('crabwatch: watching ~/.claude/sessions (Ctrl-C to quit)');
}

async function canary(filter?: string) {
  const started = Date.now();
  const typeCounts = new Map<string, number>();
  const unknownSamples = new Map<string, string>();
  const toolCounts = new Map<string, number>();
  let files = 0;
  let subagentFiles = 0;
  let lines = 0;
  let bytes = 0;
  let realUser = 0;
  let metaUser = 0;

  async function scanFile(filePath: string, isSubagent: boolean) {
    files++;
    if (isSubagent) subagentFiles++;
    const tail = new TranscriptTail(filePath);
    const parsed = await tail.readNew();
    lines += parsed.length;
    bytes += tail.offset;
    for (const { line } of parsed) {
      typeCounts.set(line.rawType, (typeCounts.get(line.rawType) ?? 0) + 1);
      if (line.kind === 'unknown' && !unknownSamples.has(line.rawType))
        unknownSamples.set(line.rawType, filePath);
      if (line.kind === 'user') line.isMeta ? metaUser++ : realUser++;
      if (line.kind === 'assistant')
        for (const tu of line.toolUses)
          toolCounts.set(tu.name, (toolCounts.get(tu.name) ?? 0) + 1);
    }
  }

  let slugs: string[] = [];
  try {
    slugs = await fsp.readdir(projectsDir);
  } catch {
    console.error(`cannot read ${projectsDir}`);
    process.exit(1);
  }
  for (const slug of slugs) {
    if (filter && !slug.toLowerCase().includes(filter.toLowerCase())) continue;
    const dir = path.join(projectsDir, slug);
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        await scanFile(path.join(dir, e.name), false);
      } else if (e.isDirectory()) {
        const subDir = path.join(dir, e.name, 'subagents');
        try {
          for (const f of await fsp.readdir(subDir)) {
            if (f.endsWith('.jsonl')) await scanFile(path.join(subDir, f), true);
          }
        } catch {
          /* 没有 subagents 目录 */
        }
      }
    }
  }

  const mb = (bytes / 1024 / 1024).toFixed(1);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\nscanned ${files} files (${subagentFiles} subagent) · ${lines} lines · ${mb} MB · ${secs}s\n`,
  );
  console.log('line types:');
  for (const [t, n] of [...typeCounts].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(8)}  ${t}${unknownSamples.has(t) ? '   ← UNKNOWN to parser' : ''}`);
  console.log(`\nuser lines: ${realUser} real · ${metaUser} meta`);
  console.log('\ntop tools:');
  for (const [t, n] of [...toolCounts].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`  ${String(n).padStart(8)}  ${t}`);
  if (unknownSamples.size > 0) {
    console.log('\nunknown type samples:');
    for (const [t, f] of unknownSamples) console.log(`  ${t}\n    ${f}`);
  }
}

if (cmd === 'watch') void watch();
else if (cmd === 'canary') void canary(process.argv[3]);
else {
  console.error(`unknown command: ${cmd} (expected watch | canary)`);
  process.exit(1);
}
