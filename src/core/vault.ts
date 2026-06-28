import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { VaultNode, VaultGraph } from '../shared/types.js';

export type { VaultNode, VaultGraph };

/**
 * 内嵌「vault」只读读取（增量1：把 Obsidian 式 markdown 库搬进 crabwatch 内浏览）。
 * 先指向用户现有的 obsidian-brain（A 方案：一份真相、与真 Obsidian 互通）；
 * 日后要换成 crabwatch 自己的库或做成设置项，只改 vaultRoot()。
 */
export function vaultRoot(): string {
  return path.join(os.homedir(), 'VSCodeWorkspace', 'personal', 'obsidian-brain');
}

/** 递归列出 .md 文件（及含 .md 的文件夹）成树；跳过隐藏目录（.obsidian/.git/.trash 等）。 */
export async function listVault(root = vaultRoot()): Promise<VaultNode[]> {
  async function walk(absDir: string, rel: string): Promise<VaultNode[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: VaultNode[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const children = await walk(path.join(absDir, e.name), childRel);
        if (children.length) nodes.push({ name: e.name, relPath: childRel, dir: true, children });
      } else if (e.name.endsWith('.md')) {
        nodes.push({ name: e.name, relPath: childRel, dir: false });
      }
    }
    // 文件夹在前，组内按名（中文用 localeCompare）
    nodes.sort((a, b) =>
      a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1,
    );
    return nodes;
  }
  return walk(root, '');
}

/** 读一篇笔记内容。路径安全：解析后必须仍落在 vault root 内（防 ../ 逃逸），且是 .md。 */
export async function readNote(relPath: string, root = vaultRoot()): Promise<string> {
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep))
    throw new Error('path escapes vault root');
  if (!abs.endsWith('.md')) throw new Error('not a markdown file');
  return fsp.readFile(abs, 'utf8');
}

const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g;

/** 从 [[target|display]] 抽出解析键：去掉 |display 与 #heading、取末段 basename 小写。 */
function resolveKey(rawTarget: string): string {
  const beforePipe = rawTarget.split('|')[0];
  const beforeHash = beforePipe.split('#')[0].trim();
  const base = beforeHash.split('/').pop() ?? beforeHash;
  return base.replace(/\.md$/i, '').toLowerCase();
}

/** 扫一篇内容里所有 wikilink 的解析键（去重）。 */
function linkKeysIn(content: string): string[] {
  const keys = new Set<string>();
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(content))) {
    const k = resolveKey(m[1]);
    if (k) keys.add(k);
  }
  return [...keys];
}

/** 扁平收集所有 .md 文件（相对路径 + basename）；跳隐藏目录，同 listVault 规则。 */
async function flatFiles(root: string): Promise<{ rel: string; name: string }[]> {
  const out: { rel: string; name: string }[] = [];
  async function walk(absDir: string, rel: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(absDir, e.name), childRel);
      else if (e.name.endsWith('.md')) out.push({ rel: childRel, name: e.name });
    }
  }
  await walk(root, '');
  return out;
}

/**
 * 一遍扫全库构建链接图（增量1 收尾，给 wikilink 解析 + backlinks 用），modal 打开时取一次。
 * resolve: basename 小写 → relPath（同名后者覆盖，v1 容忍歧义）；
 * backlinks: relPath → 链向它的笔记列表（去重、按名排序，跳过自链/未解析）。
 */
export async function vaultGraph(root = vaultRoot()): Promise<VaultGraph> {
  const files = await flatFiles(root);
  const resolve: Record<string, string> = {};
  for (const f of files) {
    resolve[f.name.replace(/\.md$/i, '').toLowerCase()] = f.rel;
  }
  const backlinks: Record<string, { rel: string; name: string }[]> = {};
  await Promise.all(
    files.map(async (f) => {
      let content: string;
      try {
        content = await fsp.readFile(path.join(root, f.rel), 'utf8');
      } catch {
        return;
      }
      for (const key of linkKeysIn(content)) {
        const targetRel = resolve[key];
        if (!targetRel || targetRel === f.rel) continue; // 未解析或自链跳过
        (backlinks[targetRel] ??= []).push({ rel: f.rel, name: f.name });
      }
    }),
  );
  for (const rel of Object.keys(backlinks)) {
    backlinks[rel].sort((a, b) => a.name.localeCompare(b.name));
  }
  return { resolve, backlinks };
}
