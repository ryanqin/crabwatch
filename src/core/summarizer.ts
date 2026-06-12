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

/**
 * 打包后的 GUI app 拿不到终端 PATH（没有 ~/.local/bin 等），
 * 按常见位置解析 claude 可执行文件，找不到再退回裸名字。
 */
let claudeBin: string | undefined;
export async function resolveClaude(): Promise<string> {
  if (claudeBin) return claudeBin;
  const candidates = [
    path.join(os.homedir(), '.local/bin/claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const c of candidates) {
    try {
      await fsp.access(c);
      claudeBin = c;
      return c;
    } catch {
      /* 下一个 */
    }
  }
  try {
    const { stdout } = await execFileP('/bin/zsh', ['-lc', 'command -v claude']);
    const found = stdout.trim().split('\n').pop();
    if (found) {
      claudeBin = found;
      return found;
    }
  } catch {
    /* 退回裸名 */
  }
  claudeBin = 'claude';
  return claudeBin;
}

/** 跑一次 headless claude -p，返回 stdout 文本 */
export async function runClaude(
  prompt: string,
  model: string,
  timeoutMs = 90_000,
): Promise<string> {
  await fsp.mkdir(HEADLESS_CWD, { recursive: true });
  const { stdout } = await execFileP(
    await resolveClaude(),
    ['-p', prompt, '--model', model, '--output-format', 'text'],
    {
      cwd: HEADLESS_CWD,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env },
    },
  );
  return stdout.trim();
}

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
    `You are recapping one work segment from an AI coding session (project ${projectName}) for the developer. In 2-4 plain sentences, explain what was done, what changed, and the outcome. No bullet points, no preamble — just the recap.`,
    '',
    `[User request] ${seg.promptFull.slice(0, 1500)}`,
    '',
    `[Assistant's final reply] ${seg.assistantGist.slice(0, 800)}`,
    '',
    `[Deterministic facts]\n${facts.join('\n')}`,
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
        await resolveClaude(),
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
