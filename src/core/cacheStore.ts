import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** CLI 模式默认缓存位置；Electron main 会传 app.getPath('userData') */
export const defaultCacheDir = path.join(os.homedir(), '.crabwatch', 'cache');

export async function readJsonCache<T>(
  cacheDir: string,
  bucket: string,
  key: string,
): Promise<T | undefined> {
  try {
    const raw = await fsp.readFile(
      path.join(cacheDir, bucket, `${key}.json`),
      'utf8',
    );
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function writeJsonCache(
  cacheDir: string,
  bucket: string,
  key: string,
  value: unknown,
): Promise<void> {
  const dir = path.join(cacheDir, bucket);
  await fsp.mkdir(dir, { recursive: true });
  // tmp 名必须唯一：并发写同一 key 时共享 tmp 会 rename 撞车
  const tmp = path.join(
    dir,
    `${key}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  await fsp.writeFile(tmp, JSON.stringify(value), 'utf8');
  await fsp.rename(tmp, path.join(dir, `${key}.json`));
}
