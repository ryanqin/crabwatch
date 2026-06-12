import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { readJsonCache, writeJsonCache } from './cacheStore.js';
import type { Segment } from '../shared/types.js';

const execFileP = promisify(execFile);

/** headless 调用的工作目录：sessionWatcher 据此忽略我们自己产生的 session */
export const HEADLESS_CWD = path.join(os.homedir(), '.crabwatch', 'headless');

function buildPrompt(seg: Segment, projectName: string): string {
  const facts: string[] = [];
  if (seg.filesEdited.length)
    facts.push(`改动文件: ${seg.filesEdited.map((f) => path.basename(f)).join(', ')}`);
  if (seg.commands.length)
    facts.push(
      `命令: ${seg.commands.map((c) => `[${c.kind}${c.ok === false ? '✗' : c.ok ? '✓' : ''}] ${c.cmd.slice(0, 80)}`).join(' | ')}`,
    );
  if (seg.commits.length)
    facts.push(`git 提交: ${seg.commits.map((c) => c.message).join('; ')}`);
  if (seg.subagents.length)
    facts.push(
      `子 agent: ${seg.subagents.map((a) => `${a.agentType}(${a.description})`).join('; ')}`,
    );
  facts.push(
    `耗时 ${(seg.durationMs / 60000).toFixed(1)} 分钟, ${seg.tokens.input + seg.tokens.output} tokens`,
  );
  return [
    `你在为开发者复盘一段 AI 编程助手的工作记录（项目 ${projectName}）。用 2-4 句直白的中文解释这段做了什么、改了哪里、结果如何。不要列点，不要客套，直接说事。`,
    '',
    `【用户的要求】${seg.promptFull.slice(0, 1500)}`,
    '',
    `【助手的收尾回复】${seg.assistantGist.slice(0, 800)}`,
    '',
    `【确定性事实】\n${facts.join('\n')}`,
  ].join('\n');
}

/** claude -p Haiku 按需摘要：并发 1 串行队列 + 按 segment hash 永久缓存 */
export class Summarizer {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private cacheDir: string) {}

  async summarize(seg: Segment, projectName: string): Promise<string> {
    const cached = await readJsonCache<{ text: string }>(
      this.cacheDir,
      'summaries',
      seg.hash,
    );
    if (cached?.text) return cached.text;

    const run = this.queue.then(async () => {
      await fsp.mkdir(HEADLESS_CWD, { recursive: true });
      const { stdout } = await execFileP(
        'claude',
        [
          '-p',
          buildPrompt(seg, projectName),
          '--model',
          'claude-haiku-4-5',
          '--output-format',
          'text',
        ],
        {
          cwd: HEADLESS_CWD,
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env },
        },
      );
      return stdout.trim();
    });
    // 队列失败不阻塞后续请求
    this.queue = run.catch(() => undefined);
    const text = await run;
    if (text)
      await writeJsonCache(this.cacheDir, 'summaries', seg.hash, {
        text,
        createdAt: Date.now(),
        model: 'claude-haiku-4-5',
      });
    return text;
  }
}
