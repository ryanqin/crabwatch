import { clipboard, systemPreferences } from 'electron';
import { focusTerminalDetailed, pasteIntoFrontmost } from './terminalFocus.js';

export interface SendResult {
  ok: boolean;
  /**
   * empty=没内容；no-terminal=没找到终端；imprecise=找到 app 但定不到那个 tab；
   * accessibility=缺辅助功能权限（已触发系统弹窗）；front-mismatch=校验时前台是别的 app；
   * error=osascript 失败。
   */
  reason?:
    | 'empty'
    | 'no-terminal'
    | 'imprecise'
    | 'accessibility'
    | 'front-mismatch'
    | 'error';
  /** front-mismatch 时实际在前台的 app；其余分支为目标终端 app */
  app?: string;
}

/**
 * 把一段文字发到某个 session 所在的终端：聚焦它的 surface → 校验前台 → 剪贴板粘贴 →
 * 可选回车提交。两道护栏：① 只在「精确命中该 session 的 surface」时才注入（否则可能
 * 打进同一终端的别的 tab）；② 注入前再确认前台仍是目标终端（pasteIntoFrontmost 内）。
 * 成功后用户消息会被 Claude Code 写回 transcript，crabwatch tail 出来 = 天然的发送确认。
 */
export async function sendToSession(
  pid: number,
  title: string | undefined,
  text: string,
  submit = true,
): Promise<SendResult> {
  if (!text.trim()) return { ok: false, reason: 'empty' };

  const focus = await focusTerminalDetailed(pid, title);
  if (!focus.ok) return { ok: false, reason: 'no-terminal' };
  if (!focus.precise) return { ok: false, reason: 'imprecise', app: focus.app };

  // 护栏：keystroke 需要「辅助功能」权限。缺权限就触发系统弹窗并告知，不盲目尝试。
  if (
    process.platform === 'darwin' &&
    !systemPreferences.isTrustedAccessibilityClient(false)
  ) {
    systemPreferences.isTrustedAccessibilityClient(true); // 弹出授权面板
    return { ok: false, reason: 'accessibility', app: focus.app };
  }

  const saved = clipboard.readText();
  clipboard.writeText(text);
  const res = await pasteIntoFrontmost(focus.app, submit);
  // 延后恢复剪贴板：给 bracketed paste 消费时间，避免刚写就被覆盖
  setTimeout(() => {
    try {
      clipboard.writeText(saved);
    } catch {
      /* 恢复失败无害 */
    }
  }, 700);

  if (res.ok) return { ok: true, app: focus.app };
  return { ok: false, reason: res.reason ?? 'error', app: res.front ?? focus.app };
}
