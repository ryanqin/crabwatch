import type { TranscriptLine, UserLine } from '../shared/types.js';

/** 用户行里这些前缀意味着不是真人敲的 prompt */
const META_TEXT_MARKERS = [
  '<command-name>',
  '<local-command-stdout>',
  '<local-command-caveat>',
  '<system-reminder>',
  '<task-notification>',
  'Caveat: ',
];

function isMetaText(text: string): boolean {
  const head = text.trimStart();
  return META_TEXT_MARKERS.some((m) => head.startsWith(m));
}

function readUserContent(content: unknown): {
  text: string;
  toolResults: UserLine['toolResults'];
} {
  if (typeof content === 'string') return { text: content, toolResults: [] };
  if (!Array.isArray(content)) return { text: '', toolResults: [] };
  const texts: string[] = [];
  const toolResults: UserLine['toolResults'] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    else if (b.type === 'tool_result')
      toolResults.push({
        toolUseId: String(b.tool_use_id ?? ''),
        isError: b.is_error === true,
      });
  }
  return { text: texts.join('\n'), toolResults };
}

export function parseTranscriptLine(raw: string): TranscriptLine {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { kind: 'unknown', rawType: '<json-parse-error>' };
  }
  if (!obj || typeof obj !== 'object') {
    return { kind: 'unknown', rawType: `<${typeof obj}>` };
  }

  const base = {
    rawType: String(obj.type ?? '<missing-type>'),
    uuid: typeof obj.uuid === 'string' ? obj.uuid : undefined,
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : undefined,
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : undefined,
    agentId: typeof obj.agentId === 'string' ? obj.agentId : undefined,
    isSidechain: obj.isSidechain === true ? true : undefined,
  };

  switch (obj.type) {
    case 'user': {
      const { text, toolResults } = readUserContent(obj.message?.content);
      const isMeta =
        obj.isMeta === true || toolResults.length > 0 || isMetaText(text);
      return { ...base, kind: 'user', text, isMeta, toolResults };
    }
    case 'assistant': {
      const blocks: any[] = Array.isArray(obj.message?.content)
        ? obj.message.content
        : [];
      const text = blocks
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n');
      const toolUses = blocks
        .filter((b) => b?.type === 'tool_use')
        .map((b) => ({
          id: String(b.id ?? ''),
          name: String(b.name ?? ''),
          input: b.input as unknown,
        }));
      return {
        ...base,
        kind: 'assistant',
        model:
          typeof obj.message?.model === 'string' ? obj.message.model : undefined,
        usage: obj.message?.usage ?? undefined,
        text,
        toolUses,
      };
    }
    case 'system':
      return {
        ...base,
        kind: 'system',
        subtype: typeof obj.subtype === 'string' ? obj.subtype : undefined,
        durationMs:
          typeof obj.durationMs === 'number'
            ? obj.durationMs
            : typeof obj.duration_ms === 'number'
              ? obj.duration_ms
              : undefined,
      };
    case 'ai-title':
      return {
        ...base,
        kind: 'ai-title',
        title: String(obj.aiTitle ?? obj.title ?? ''),
      };
    default:
      return { ...base, kind: 'unknown' };
  }
}
