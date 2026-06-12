/**
 * 程序化生成原创像素螃蟹 sprite sheet（不依赖任何第三方美术素材）。
 * PICO PARK 风格：16×16 粗颗粒 + 厚轮廓 + 扁平色块，渲染时 4x 放大。
 * 输出：
 *   src/renderer/src/assets/crab.png        14 帧 × 4 色，每帧 16×16
 *   src/renderer/src/assets/crabFrames.ts   帧表（状态 → 帧序列 + fps）
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const F = 16; // 帧边长
const FRAME_COUNT = 14;

interface Palette {
  outline: string;
  body: string;
  light: string;
  claw: string;
}
const VARIANTS: Palette[] = [
  { outline: '#43200c', body: '#f08030', light: '#ffb066', claw: '#d86020' }, // 橙
  { outline: '#4a1616', body: '#e04848', light: '#ff8a70', claw: '#c03434' }, // 红
  { outline: '#2e1c45', body: '#a86ce0', light: '#cfa0f0', claw: '#8a50c4' }, // 紫
  { outline: '#0e3634', body: '#38b0a8', light: '#80dcd0', claw: '#289089' }, // 青
];
const EYE_WHITE = '#ffffff';
const EYE_BLACK = '#202020';

interface Pose {
  bodyDy: number;
  legPhase: 0 | 1;
  eyes: 'open' | 'closed' | 'up';
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
  { bodyDy: 1, legPhase: 0, eyes: 'closed', claws: 'tucked' }, // 12 sleeping
  { bodyDy: 2, legPhase: 0, eyes: 'closed', claws: 'tucked' }, // 13 sleeping
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
}

/** 3×3 厚轮廓方钳，PICO 式大色块 */
function drawClaw(f: Frame, p: Palette, x: number, y: number) {
  f.rect(x, y, 3, 3, p.outline);
  f.px(x + 1, y + 1, p.claw);
}

function drawCrab(f: Frame, p: Palette, pose: Pose) {
  const cy = 9 + pose.bodyDy;

  // 腿：两侧各 2 个粗 nub，相位交替
  const ph = pose.legPhase;
  if (pose.claws !== 'tucked') {
    f.px(3, cy + 3 + ph, p.outline);
    f.px(2, cy + 2 - ph + 1, p.outline);
    f.px(12, cy + 3 + ph, p.outline);
    f.px(13, cy + 2 - ph + 1, p.outline);
  }

  // 身体：厚轮廓圆角方块（11×7 外框）
  f.rect(3, cy - 2, 10, 6, p.outline);
  f.rect(4, cy - 3, 8, 8, p.outline);
  f.rect(4, cy - 2, 8, 6, p.body);
  f.rect(5, cy - 2, 2, 2, p.light); // 高光块

  // 眼睛：大块白眼 + 黑瞳（直接长在身体上沿，PICO 式大眼）
  for (const ex of [5, 9]) {
    if (pose.eyes === 'closed') {
      f.rect(ex, cy - 2, 2, 1, p.outline);
    } else {
      f.rect(ex, cy - 3, 2, 3, EYE_WHITE);
      const pupilY = pose.eyes === 'up' ? cy - 3 : cy - 2;
      f.px(ex + 1, pupilY, EYE_BLACK);
      f.px(ex, pupilY + 1, EYE_WHITE);
    }
  }

  // 钳子
  switch (pose.claws) {
    case 'normal':
      drawClaw(f, p, 0, cy - 3);
      drawClaw(f, p, 13, cy - 3);
      break;
    case 'typing0':
      drawClaw(f, p, 2, cy + 3);
      drawClaw(f, p, 11, cy + 2);
      break;
    case 'typing1':
      drawClaw(f, p, 2, cy + 2);
      drawClaw(f, p, 11, cy + 3);
      break;
    case 'think':
      drawClaw(f, p, 0, cy - 3);
      drawClaw(f, p, 11, cy - 6);
      break;
    case 'wave0':
      drawClaw(f, p, 0, cy - 3);
      drawClaw(f, p, 13, cy - 8);
      break;
    case 'wave1':
      drawClaw(f, p, 0, cy - 3);
      drawClaw(f, p, 13, cy - 6);
      break;
    case 'tucked':
      drawClaw(f, p, 1, cy + 1);
      drawClaw(f, p, 12, cy + 1);
      break;
  }
}

const png = new PNG({
  width: FRAME_COUNT * F,
  height: VARIANTS.length * F,
  colorType: 6,
});
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
  walk: { frames: [2, 3, 4, 5], fps: 4 },
  typing: { frames: [6, 7], fps: 5 },
  thinking: { frames: [8, 9], fps: 1.5 },
  waiting: { frames: [10, 11], fps: 2 },
  sleeping: { frames: [12, 13], fps: 0.7 },
} as const;
export type CrabAnimName = keyof typeof CRAB_ANIM;
`;
fs.writeFileSync(path.join(outDir, 'crabFrames.ts'), framesTs);
console.log(`sprites written → ${outDir} (${png.width}×${png.height})`);
