import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import { parseTranscriptLine } from './transcriptParse.js';
import type { ParsedLine } from '../shared/types.js';

/**
 * 读文件末尾最近 maxLines 条解析行（SessionPanel 打开时取历史用）。
 * 只读末尾 maxBytes，行号无从知晓置 -1。
 */
export async function readRecentLines(
  filePath: string,
  maxLines: number,
  maxBytes = 512 * 1024,
): Promise<ParsedLine[]> {
  let size: number;
  try {
    size = (await fsp.stat(filePath)).size;
  } catch {
    return [];
  }
  const start = Math.max(0, size - maxBytes);
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { start, end: size - 1 });
    stream.on('data', (c) => chunks.push(c as Buffer));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  let buf = Buffer.concat(chunks);
  let bufStart = start;
  if (start > 0) {
    const firstNl = buf.indexOf(0x0a);
    if (firstNl === -1) return [];
    bufStart += firstNl + 1;
    buf = buf.subarray(firstNl + 1);
  }
  const out: ParsedLine[] = [];
  for (const raw of buf.toString('utf8').split('\n')) {
    const byteStart = bufStart;
    bufStart += Buffer.byteLength(raw, 'utf8') + 1;
    if (raw.trim().length === 0) continue;
    out.push({
      lineNo: -1,
      byteStart,
      byteEnd: bufStart - 1,
      line: parseTranscriptLine(raw),
    });
  }
  return out.slice(-maxLines);
}

/**
 * 单个 JSONL 文件的增量 tail。
 * - bufStart：buf 在文件中的起始 byte（= 下一条未消费行的起点，可持久化作恢复点）
 * - 不完整的末行留在 buf 里等下次 readNew
 * - 文件被截断（size < bufStart）时重置全量重读
 */
export class TranscriptTail {
  private buf: Buffer = Buffer.alloc(0);
  private bufStart = 0;
  private lineNo = 0;

  constructor(readonly filePath: string) {}

  get offset(): number {
    return this.bufStart;
  }

  /** 跳过现有内容，只 tail 之后的新行（lineNo 从当前文件实际行数继续无从得知，置 0 起算相对行号） */
  async seekToEnd(): Promise<void> {
    try {
      const st = await fsp.stat(this.filePath);
      this.bufStart = st.size;
    } catch {
      this.bufStart = 0;
    }
    this.buf = Buffer.alloc(0);
    this.lineNo = 0;
  }

  async readNew(): Promise<ParsedLine[]> {
    let size: number;
    try {
      size = (await fsp.stat(this.filePath)).size;
    } catch {
      return []; // 文件还没创建
    }
    if (size < this.bufStart) {
      this.bufStart = 0;
      this.buf = Buffer.alloc(0);
      this.lineNo = 0;
    }
    const readPos = this.bufStart + this.buf.length;
    if (size > readPos) {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(this.filePath, {
          start: readPos,
          end: size - 1,
          highWaterMark: 1 << 20,
        });
        stream.on('data', (c) => chunks.push(c as Buffer));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      this.buf = Buffer.concat([this.buf, ...chunks]);
    }

    const out: ParsedLine[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf(0x0a)) !== -1) {
      const lineBuf = this.buf.subarray(0, nl);
      const byteStart = this.bufStart;
      this.bufStart += nl + 1;
      this.buf = this.buf.subarray(nl + 1);
      this.lineNo++;
      const raw = lineBuf.toString('utf8');
      if (raw.trim().length > 0) {
        out.push({
          lineNo: this.lineNo,
          byteStart,
          byteEnd: this.bufStart - 1,
          line: parseTranscriptLine(raw),
        });
      }
    }
    return out;
  }
}
