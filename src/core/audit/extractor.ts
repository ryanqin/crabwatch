import { createHash } from 'node:crypto';
import { classifyCommand, extractCommitMessage } from './classify.js';
import type { ParsedLine, Segment } from '../../shared/types.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);

interface Acc {
  startLine: number;
  startByte: number;
  endLine: number;
  endByte: number;
  prompt: string;
  gist: string;
  startedAt?: string;
  endedAt?: string;
  lastUuid?: string;
  filesEdited: Set<string>;
  filesReadCount: number;
  commands: { cmd: string; kind: Segment['commands'][number]['kind']; ok: boolean | null; toolUseId: string }[];
  commits: { message: string }[];
  subagents: { agentType: string; description: string }[];
  tokens: { input: number; output: number; cacheRead: number };
  durationMs: number;
  models: Set<string>;
}

function finalize(acc: Acc, sessionId: string): Segment {
  const hash = createHash('sha1')
    .update(`${sessionId}:${acc.startLine}:${acc.endLine}:${acc.lastUuid ?? ''}`)
    .digest('hex')
    .slice(0, 16);
  return {
    id: `${sessionId.slice(0, 8)}-${acc.startLine}`,
    hash,
    promptPreview: acc.prompt.replace(/\s+/g, ' ').trim().slice(0, 200),
    promptFull: acc.prompt.slice(0, 4000),
    assistantGist: acc.gist.replace(/\s+/g, ' ').trim().slice(0, 300),
    filesEdited: [...acc.filesEdited],
    filesReadCount: acc.filesReadCount,
    commands: acc.commands.map(({ cmd, kind, ok }) => ({
      cmd: cmd.slice(0, 200),
      kind,
      ok,
    })),
    commits: acc.commits,
    subagents: acc.subagents,
    tokens: acc.tokens,
    durationMs: acc.durationMs,
    models: [...acc.models],
    lineRange: [acc.startLine, acc.endLine],
    byteRange: [acc.startByte, acc.endByte],
    startedAt: acc.startedAt,
    endedAt: acc.endedAt,
  };
}

/** 整个 transcript 的解析行 → 审计 segments（确定性，零 LLM） */
export function extractSegments(
  lines: ParsedLine[],
  sessionId: string,
): { segments: Segment[]; title?: string; firstTs?: string; lastTs?: string } {
  const segments: Segment[] = [];
  let acc: Acc | undefined;
  let title: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;

  for (const pl of lines) {
    const { line } = pl;
    if (line.timestamp) {
      firstTs ??= line.timestamp;
      lastTs = line.timestamp;
    }
    if (line.kind === 'ai-title') {
      if (line.title) title = line.title;
      continue;
    }

    const isRealPrompt =
      line.kind === 'user' && !line.isMeta && line.text.trim().length > 0;
    if (isRealPrompt) {
      if (acc) segments.push(finalize(acc, sessionId));
      acc = {
        startLine: pl.lineNo,
        startByte: pl.byteStart,
        endLine: pl.lineNo,
        endByte: pl.byteEnd,
        prompt: line.kind === 'user' ? line.text : '',
        gist: '',
        startedAt: line.timestamp,
        filesEdited: new Set(),
        filesReadCount: 0,
        commands: [],
        commits: [],
        subagents: [],
        tokens: { input: 0, output: 0, cacheRead: 0 },
        durationMs: 0,
        models: new Set(),
      };
      continue;
    }
    if (!acc) continue; // 首条真实 prompt 之前的引导行

    acc.endLine = pl.lineNo;
    acc.endByte = pl.byteEnd;
    if (line.timestamp) acc.endedAt = line.timestamp;
    if (line.uuid) acc.lastUuid = line.uuid;

    switch (line.kind) {
      case 'assistant': {
        if (line.model) acc.models.add(line.model);
        if (line.usage) {
          acc.tokens.input += line.usage.input_tokens ?? 0;
          acc.tokens.output += line.usage.output_tokens ?? 0;
          acc.tokens.cacheRead += line.usage.cache_read_input_tokens ?? 0;
        }
        if (line.text) acc.gist = line.text;
        for (const tu of line.toolUses) {
          const input = (tu.input ?? {}) as Record<string, unknown>;
          if (EDIT_TOOLS.has(tu.name) && typeof input.file_path === 'string')
            acc.filesEdited.add(input.file_path);
          else if (READ_TOOLS.has(tu.name)) acc.filesReadCount++;
          else if (tu.name === 'Bash' && typeof input.command === 'string') {
            const kind = classifyCommand(input.command);
            acc.commands.push({
              cmd: input.command,
              kind,
              ok: null,
              toolUseId: tu.id,
            });
            const commitMsg = extractCommitMessage(input.command);
            if (commitMsg) acc.commits.push({ message: commitMsg });
          } else if (AGENT_TOOLS.has(tu.name)) {
            acc.subagents.push({
              agentType: String(input.subagent_type ?? 'agent'),
              description: String(input.description ?? '').slice(0, 80),
            });
          }
        }
        break;
      }
      case 'user': {
        // meta user 行携带 tool_result：回填命令成败
        for (const r of line.toolResults) {
          const cmd = acc.commands.find(
            (c) => c.toolUseId === r.toolUseId && c.ok === null,
          );
          if (cmd) cmd.ok = !r.isError;
        }
        break;
      }
      case 'system':
        if (line.subtype === 'turn_duration' && line.durationMs)
          acc.durationMs += line.durationMs;
        break;
    }
  }
  if (acc) segments.push(finalize(acc, sessionId));
  return { segments, title, firstTs, lastTs };
}
