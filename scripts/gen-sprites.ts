/**
 * 程序化生成原创像素螃蟹 sprite sheet（不依赖任何第三方美术素材）。
 * 输出：
 *   src/renderer/src/assets/crab.png        14 帧 × 4 色，每帧 32×32
 *   src/renderer/src/assets/crabFrames.ts   帧表（状态 → 帧序列 + fps）
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const F = 32; // 帧边长
const FRAME_COUNT = 14;

interface Palette {
  outline: string;
  body: string;
  light: string;
  claw: string;
}
const VARIANTS: Palette[] = [
  { outline: '#5a2410', body: '#e8763a', light: '#f4a261', claw: '#d65f28' }, // 橙
  { outline: '#571d1d', body: '#d64545', light: '#ef8b6d', claw: '#b93535' }, // 红
  { outline: '#3c2455', body: '#9d6bd0', light: '#c39ae8', claw: '#8453b8' }, // 紫
  { outline: '#15403d', body: '#3aa6a6', light: '#7fd1c8', claw: '#2c8888' }, // 青
];
const EYE_WHITE = '#fdf6e3';
const EYE_BLACK = '#1a1a1a';

interface Pose {
  bodyDy: number;
  legPhase: 0 | 1;
  eyes: 'open' | 'closed' | 'up';
  /** 钳子模式 */
  claws: 'normal' | 'typing0' | 'typing1' | 'think' | 'wave0' | 'wave1' | 'tucked';
}

const POSES: Pose[] = [
  { bodyDy: 0, legPhase: 0, eyes: 'open', claws: 'normal' }, // 0 idle
  { bodyDy: 1, legPhase: 0, eyes: 'open', claws: 'normal' }, // 1 idle
  { bodyDy: 0, legPhase: 0, eyes: 'open', claws: 'normal' }, // 2 walk
  { bodyDy: 1, legPhase: 1, eyes: 'open', claws: 'normal' }, // 3 walk
  { bodyDy: 0, legPhase: 0, eyes: 'open', claws: 'normal' }, // 4 walk
  { bodyDy: 1, legPhase: 1, eyes: 'open', claws: 'normal' }, // 5 walk
  { bodyDy: 0, legPhase: 0, eyes: 'open', claws: 'typing0' }, // 6 typing
  { bodyDy: 0, legPhase: 0, eyes: 'open', claws: 'typing1' }, // 7 typing
  { bodyDy: 0, legPhase: 0, eyes: 'up', claws: 'think' }, // 8 thinking
  { bodyDy: 1, legPhase: 0, eyes: 'up', claws: 'think' }, // 9 thinking
  { bodyDy: 0, legPhase: 0, eyes: 'open', claws: 'wave0' }, // 10 waiting
  { bodyDy: 0, legPhase: 0, eyes: 'open', claws: 'wave1' }, // 11 waiting
  { bodyDy: 2, legPhase: 0, eyes: 'closed', claws: 'tucked' }, // 12 sleeping
  { bodyDy: 3, legPhase: 0, eyes: 'closed', claws: 'tucked' }, // 13 sleeping
];

function hex(c: string): [number, number, number] {
  return [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
}

class Frame {
  constructor(
    private png: PNG,
    private ox: number,
    private oy: number,
  ) {}
  px(x: number, y: number, color: string) {
    if (x < 0 || y < 0 || x >= F || y >= F) return;
    const [r, g, b] = hex(color);
    const i = ((this.oy + y) * this.png.width + this.ox + x) * 4;
    this.png.data[i] = r;
    this.png.data[i + 1] = g;
    this.png.data[i + 2] = b;
    this.png.data[i + 3] = 255;
  }
  rect(x: number, y: number, w: number, h: number, color: string) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) this.px(x + dx, y + dy, color);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, color: string) {
    for (let y = -ry; y <= ry; y++)
      for (let x = -rx; x <= rx; x++)
        if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1.0)
          this.px(cx + x, cy + y, color);
  }
}

function drawClaw(f: Frame, p: Palette, cx: number, cy: number, open: boolean) {
  f.ellipse(cx, cy, 3, 3, p.outline);
  f.ellipse(cx, cy, 2, 2, p.claw);
  if (open) {
    // 钳口缺槽
    f.px(cx, cy - 2, p.outline);
    f.px(cx, cy - 1, p.outline);
  }
}

function drawCrab(f: Frame, p: Palette, pose: Pose) {
  const cy = 19 + pose.bodyDy;

  // 腿：每侧 3 条，两相交替
  const legY = [0, 2, 4];
  for (let i = 0; i < 3; i++) {
    const phase = (i + pose.legPhase) % 2;
    const ly = cy + 1 + legY[i] - (pose.claws === 'tucked' ? 1 : 0);
    // 左
    f.px(7 - i, ly + phase, p.outline);
    f.px(8 - i, ly + phase, p.outline);
    f.px(9 - i, ly - 1 + phase, p.outline);
    // 右
    f.px(25 + i, ly + phase, p.outline);
    f.px(24 + i, ly + phase, p.outline);
    f.px(23 + i, ly - 1 + phase, p.outline);
  }

  // 身体
  f.ellipse(16, cy, 9, 7, p.outline);
  f.ellipse(16, cy, 8, 6, p.body);
  f.ellipse(13, cy - 2, 3, 2, p.light);
  // 嘴
  f.px(15, cy + 3, p.outline);
  f.px(16, cy + 3, p.outline);
  f.px(17, cy + 3, p.outline);

  // 眼柄 + 眼睛
  for (const ex of [12, 20]) {
    const stalkTop = cy - 9;
    f.px(ex, stalkTop + 2, p.outline);
    f.px(ex, stalkTop + 1, p.outline);
    if (pose.eyes === 'closed') {
      f.rect(ex - 1, stalkTop - 1, 3, 1, p.outline);
    } else {
      f.rect(ex - 1, stalkTop - 2, 3, 3, EYE_WHITE);
      const pupilY = pose.eyes === 'up' ? stalkTop - 2 : stalkTop - 1;
      f.px(ex, pupilY, EYE_BLACK);
    }
  }

  // 钳子
  switch (pose.claws) {
    case 'normal':
      drawClaw(f, p, 5, cy - 2, true);
      drawClaw(f, p, 27, cy - 2, true);
      break;
    case 'typing0':
      drawClaw(f, p, 10, cy + 6, false);
      drawClaw(f, p, 22, cy + 4, false);
      break;
    case 'typing1':
      drawClaw(f, p, 10, cy + 4, false);
      drawClaw(f, p, 22, cy + 6, false);
      break;
    case 'think':
      drawClaw(f, p, 5, cy - 2, true);
      drawClaw(f, p, 21, cy - 8, false); // 抵着下巴
      break;
    case 'wave0':
      drawClaw(f, p, 5, cy - 2, true);
      drawClaw(f, p, 27, cy - 10, true); // 高举挥手
      break;
    case 'wave1':
      drawClaw(f, p, 5, cy - 2, true);
      drawClaw(f, p, 26, cy - 7, true);
      break;
    case 'tucked':
      drawClaw(f, p, 8, cy + 2, false);
      drawClaw(f, p, 24, cy + 2, false);
      break;
  }
}

const png = new PNG({
  width: FRAME_COUNT * F,
  height: VARIANTS.length * F,
  colorType: 6,
});
// 全透明底
png.data.fill(0);

VARIANTS.forEach((palette, row) => {
  POSES.forEach((pose, col) => {
    drawCrab(new Frame(png, col * F, row * F), palette, pose);
  });
});

const outDir = path.join(import.meta.dirname, '../src/renderer/src/assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'crab.png'), PNG.sync.write(png));

const framesTs = `// 由 scripts/gen-sprites.ts 生成，勿手改
export const CRAB_FRAME_SIZE = ${F};
export const CRAB_COLORS = ${VARIANTS.length};
export const CRAB_ANIM = {
  idle: { frames: [0, 1], fps: 1.5 },
  walk: { frames: [2, 3, 4, 5], fps: 6 },
  typing: { frames: [6, 7], fps: 5 },
  thinking: { frames: [8, 9], fps: 1.5 },
  waiting: { frames: [10, 11], fps: 2 },
  sleeping: { frames: [12, 13], fps: 0.7 },
} as const;
export type CrabAnimName = keyof typeof CRAB_ANIM;
`;
fs.writeFileSync(path.join(outDir, 'crabFrames.ts'), framesTs);
console.log(`sprites written → ${outDir} (${png.width}×${png.height})`);
