import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** 从进程环境里抓终端定位信息（TERM_PROGRAM / ITERM_SESSION_ID 等无空格变量） */
async function envOf(pid: number): Promise<Record<string, string>> {
  try {
    const { stdout } = await execFileP('ps', ['eww', '-o', 'command=', '-p', String(pid)]);
    const env: Record<string, string> = {};
    for (const tok of stdout.split(/\s+/)) {
      const m = tok.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
    return env;
  } catch {
    return {};
  }
}

async function ttyOf(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('ps', ['-o', 'tty=', '-p', String(pid)]);
    const tty = stdout.trim();
    return tty && tty !== '??' ? `/dev/${tty}` : undefined;
  } catch {
    return undefined;
  }
}

/** claude 进程自身的工作目录（≈ 启动它的 shell 所在目录） */
async function cwdOf(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const line = stdout.split('\n').find((l) => l.startsWith('n'));
    return line?.slice(1);
  } catch {
    return undefined;
  }
}

function escapeAS(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function osa(script: string): Promise<string> {
  const { stdout } = await execFileP('osascript', ['-e', script], { timeout: 4000 });
  return stdout.trim();
}

/**
 * 把对应 session 的终端窗口拉到前台。
 * Ghostty / iTerm2 / Terminal.app 能精确到 surface/tab；VS Code 系激活应用；
 * 其余返回 false。首次会弹 macOS 自动化授权。
 */
export async function focusTerminal(
  pid: number,
  sessionTitle?: string,
): Promise<boolean> {
  const env = await envOf(pid);
  const prog = (env.TERM_PROGRAM ?? '').toLowerCase();

  try {
    if (prog === 'ghostty') {
      // 首选按 surface 标题匹配：Claude Code 会把 session 标题写进终端标题，
      // 比 working directory 唯一（同目录开多个 session 时 cwd 会抓错）
      if (sessionTitle) {
        const result = await osa(`
          tell application "Ghostty"
            set matches to every terminal whose name contains "${escapeAS(sessionTitle)}"
            if (count of matches) > 0 then
              focus (item 1 of matches)
              return "ok"
            end if
            return "miss"
          end tell`);
        if (result === 'ok') return true;
      }
      const cwd = await cwdOf(pid);
      if (cwd) {
        const result = await osa(`
          tell application "Ghostty"
            set matches to every terminal whose working directory is "${escapeAS(cwd)}"
            if (count of matches) > 0 then
              focus (item 1 of matches)
              return "ok"
            end if
            activate
            return "miss"
          end tell`);
        return result === 'ok' || result === 'miss';
      }
      await osa('tell application "Ghostty" to activate');
      return true;
    }

    if (prog === 'iterm.app') {
      const uuid = env.ITERM_SESSION_ID?.split(':').pop();
      if (uuid) {
        const result = await osa(`
          tell application "iTerm2"
            repeat with w in windows
              repeat with t in tabs of w
                repeat with s in sessions of t
                  if id of s is "${escapeAS(uuid)}" then
                    select s
                    select t
                    set index of w to 1
                    activate
                    return "ok"
                  end if
                end repeat
              end repeat
            end repeat
            activate
            return "miss"
          end tell`);
        return result === 'ok' || result === 'miss';
      }
      await osa('tell application "iTerm2" to activate');
      return true;
    }

    if (prog === 'apple_terminal') {
      const tty = await ttyOf(pid);
      if (tty) {
        const result = await osa(`
          tell application "Terminal"
            repeat with w in windows
              repeat with t in tabs of w
                if tty of t is "${escapeAS(tty)}" then
                  set selected of t to true
                  set index of w to 1
                  activate
                  return "ok"
                end if
              end repeat
            end repeat
            activate
            return "miss"
          end tell`);
        return result === 'ok' || result === 'miss';
      }
      await osa('tell application "Terminal" to activate');
      return true;
    }

    if (prog === 'vscode') {
      const isCursor = Object.values(env).some((v) => v.includes('Cursor'));
      await osa(
        `tell application "${isCursor ? 'Cursor' : 'Visual Studio Code'}" to activate`,
      );
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
