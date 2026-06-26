import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { VaultNode } from '../shared/types.js';

export type { VaultNode };

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
