/**
 * 程序化 8-bit 提示音（Web Audio 合成，无素材文件）。
 * 只配两个真信号：complete=干完活等输入，confirm=要权限/提醒。
 * 默认关（settings 开），全局 10s 冷却——余光工具不连环响。
 */
let ctx: AudioContext | undefined;
let lastAt = 0;
const COOLDOWN_MS = 10_000;

export function soundsEnabled(): boolean {
  return localStorage.getItem('cw-sounds') === '1';
}

function blip(ac: AudioContext, freq: number, at: number, dur: number) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.05, at + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** force=true 跳过开关与冷却（settings 试听用） */
export function playSound(kind: 'complete' | 'confirm', force = false) {
  if (!force && !soundsEnabled()) return;
  const now = Date.now();
  if (!force && now - lastAt < COOLDOWN_MS) return;
  lastAt = now;
  ctx ??= new AudioContext();
  void ctx.resume();
  const t = ctx.currentTime + 0.01;
  if (kind === 'complete') {
    // 上行琶音 C5→E5→G5：明亮的「干完了」
    blip(ctx, 523.25, t, 0.09);
    blip(ctx, 659.25, t + 0.07, 0.09);
    blip(ctx, 783.99, t + 0.14, 0.16);
  } else {
    // 两音上扬 E5→A5：问询感的「该你了」
    blip(ctx, 659.25, t, 0.09);
    blip(ctx, 880, t + 0.09, 0.18);
  }
}

// 调试钩子（CW_CAPTURE_JS / devtools 试听）
(window as unknown as Record<string, unknown>).__cwSound = playSound;
