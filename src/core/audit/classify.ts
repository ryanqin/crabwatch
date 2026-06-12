import type { CommandKind } from '../../shared/types.js';

const TEST_RE =
  /\b(pytest|jest|vitest|mocha|playwright|unittest|go test|cargo test|npm (run )?test|yarn test|pnpm test|tsc --noEmit|typecheck)\b/;
const BUILD_RE =
  /\b(npm run build|yarn build|pnpm build|cargo build|go build|make|gradle|webpack|vite build|electron-vite build|tsc\b(?! --noEmit))/;
const INSTALL_RE =
  /\b(npm (i|install)|yarn add|pnpm (add|install)|pip install|cargo add|brew install|apt(-get)? install)\b/;

export function classifyCommand(cmd: string): CommandKind {
  if (TEST_RE.test(cmd)) return 'test';
  if (BUILD_RE.test(cmd)) return 'build';
  if (/\bgit\b/.test(cmd)) return 'git';
  if (INSTALL_RE.test(cmd)) return 'install';
  return 'other';
}

/** 从 git commit 命令里抠出 -m 的提交信息（拿不到 sha，够用） */
export function extractCommitMessage(cmd: string): string | undefined {
  if (!/git commit/.test(cmd)) return undefined;
  const m = cmd.match(/-m\s+(?:"([^"]+)"|'([^']+)')/);
  return m ? (m[1] ?? m[2]) : '(commit)';
}
