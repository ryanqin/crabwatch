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
  const { stdout } = await execFileP('osascript', ['-e', script], { timeout: 6000 });
  return stdout.trim();
}

/**
 * focus 结果。`app` = 该终端在 System Events 里的进程名（前台校验护栏要用），
 * `precise` = 是否精确命中了那个 session 自己的 surface/tab（而非只把 app 拉前台）。
 * 发消息只在 precise 时才敢粘贴+回车——否则可能打进同一 app 的别的 tab。
 */
export interface FocusResult {
  ok: boolean;
  precise: boolean;
  app: string;
}

/**
 * 把对应 session 的终端窗口拉到前台，并报告命中精度。
 * Ghostty / iTerm2 / Terminal.app 能精确到 surface/tab；VS Code 系只能激活应用（非精确）；
 * 其余返回 ok:false。首次会弹 macOS 自动化授权。
 */
export async function focusTerminalDetailed(
  pid: number,
  sessionTitle?: string,
): Promise<FocusResult> {
  const env = await envOf(pid);
  const prog = (env.TERM_PROGRAM ?? '').toLowerCase();

  try {
    if (prog === 'ghostty') {
      const app = 'Ghostty';
      // 首选按 surface 标题匹配：Claude Code 会把 session 标题写进终端标题，
      // 比 working directory 唯一（同目录开多个 session 时 cwd 会抓错）
      if (sessionTitle) {
        const result = await osa(`
          tell application "Ghostty"
            set matches to every terminal whose name contains "${escapeAS(sessionTitle)}"
            if (count of matches) > 0 then
              focus (item 1 of matches)
              activate
              return "ok"
            end if
            return "miss"
          end tell`);
        if (result === 'ok') return { ok: true, precise: true, app };
      }
      const cwd = await cwdOf(pid);
      if (cwd) {
        const result = await osa(`
          tell application "Ghostty"
            set matches to every terminal whose working directory is "${escapeAS(cwd)}"
            if (count of matches) > 0 then
              focus (item 1 of matches)
              activate
              return "ok"
            end if
            activate
            return "miss"
          end tell`);
        if (result === 'ok') return { ok: true, precise: true, app };
        if (result === 'miss') return { ok: true, precise: false, app };
      }
      await osa('tell application "Ghostty" to activate');
      return { ok: true, precise: false, app };
    }

    if (prog === 'iterm.app') {
      const app = 'iTerm2';
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
        if (result === 'ok') return { ok: true, precise: true, app };
        if (result === 'miss') return { ok: true, precise: false, app };
      }
      await osa('tell application "iTerm2" to activate');
      return { ok: true, precise: false, app };
    }

    if (prog === 'apple_terminal') {
      const app = 'Terminal';
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
        if (result === 'ok') return { ok: true, precise: true, app };
        if (result === 'miss') return { ok: true, precise: false, app };
      }
      await osa('tell application "Terminal" to activate');
      return { ok: true, precise: false, app };
    }

    if (prog === 'vscode') {
      // 集成终端无法精确定位面板，只能激活应用 → 非精确，发消息会拒绝自动提交
      const isCursor = Object.values(env).some((v) => v.includes('Cursor'));
      await osa(
        `tell application "${isCursor ? 'Cursor' : 'Visual Studio Code'}" to activate`,
      );
      return { ok: true, precise: false, app: isCursor ? 'Cursor' : 'Code' };
    }
  } catch {
    return { ok: false, precise: false, app: '' };
  }
  return { ok: false, precise: false, app: '' };
}

/** 老入口（terminal↗ 按钮）：只关心能不能把终端拉到前台 */
export async function focusTerminal(
  pid: number,
  sessionTitle?: string,
): Promise<boolean> {
  return (await focusTerminalDetailed(pid, sessionTitle)).ok;
}

export interface PasteResult {
  ok: boolean;
  reason?: 'front-mismatch' | 'accessibility' | 'error';
  front?: string;
}

/**
 * 前台校验护栏 + 注入。一次 osascript 内完成「确认前台仍是目标终端 → Cmd+V 粘贴
 * → 可选 Return 提交」，把校验和击键放在同一个原子块里，最小化「校验通过后用户切走
 * 又粘进别处」的竞态窗口。剪贴板必须由调用方提前写好。
 * 给 activate 一点时间生效：最多轮询 ~300ms 等目标 app 成为前台，仍不是才判 mismatch。
 * keystroke 需要「辅助功能」权限，缺权限时 osascript 抛错 → reason='accessibility'。
 */
export async function pasteIntoFrontmost(
  expectedApp: string,
  submit: boolean,
): Promise<PasteResult> {
  const want = escapeAS(expectedApp);
  const submitLine = submit ? '\n              delay 0.15\n              key code 36' : '';
  const script = `
    tell application "System Events"
      set theApp to ""
      repeat 6 times
        set theApp to name of first application process whose frontmost is true
        if theApp is "${want}" then exit repeat
        delay 0.05
      end repeat
      if theApp is not "${want}" then return "front:" & theApp
      keystroke "v" using command down${submitLine}
      return "ok"
    end tell`;
  try {
    const out = await osa(script);
    if (out === 'ok') return { ok: true };
    if (out.startsWith('front:'))
      return { ok: false, reason: 'front-mismatch', front: out.slice(6) };
    return { ok: false, reason: 'error' };
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    // -1719 / -25211 / "not allowed assistive access" 都是缺辅助功能权限
    if (/assistive access|not allowed|1719|25211/i.test(msg))
      return { ok: false, reason: 'accessibility' };
    return { ok: false, reason: 'error' };
  }
}
