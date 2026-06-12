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
  eyes: 'open' | 'closed' | 'up' | 'x';
  claws:
    | 'normal'
    | 'typing0'
    | 'typing1'
    | 'think'
    | 'wave0'
    | 'wave1'
    | 'tucked'
    | 'dig0'
    | 'dig1'
    | 'sweep0'
    | 'sweep1'
    | 'juggle0'
    | 'juggle1';
  /** 钻沙：下半身埋进沙里 */
  buried?: boolean;
  /** 耍杂技的球（0/1 = 两个相位） */
  balls?: 0 | 1;
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
  { bodyDy: 1, legPhase: 0, eyes: 'open', claws: 'dig0' }, // 14 digging
  { bodyDy: 2, legPhase: 1, eyes: 'open', claws: 'dig1' }, // 15 digging
  { bodyDy: 3, legPhase: 0, eyes: 'open', claws: 'tucked', buried: true }, // 16 burrow
  { bodyDy: 4, legPhase: 0, eyes: 'open', claws: 'tucked', buried: true }, // 17 burrow
  { bodyDy: 2, legPhase: 0, eyes: 'x', claws: 'tucked' }, // 18 error
  { bodyDy: 3, legPhase: 0, eyes: 'x', claws: 'tucked' }, // 19 error
  { bodyDy: 1, legPhase: 0, eyes: 'open', claws: 'sweep0' }, // 20 compact 扫地
  { bodyDy: 1, legPhase: 1, eyes: 'open', claws: 'sweep1' }, // 21 compact
  { bodyDy: 0, legPhase: 0, eyes: 'up', claws: 'juggle0', balls: 0 }, // 22 juggle
  { bodyDy: 1, legPhase: 1, eyes: 'up', claws: 'juggle1', balls: 1 }, // 23 juggle
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
    } else if (pose.eyes === 'x') {
      // 出错的晕眩眼：对角双点
      f.rect(ex, cy - 3, 2, 3, EYE_WHITE);
      f.px(ex, cy - 3, EYE_BLACK);
      f.px(ex + 1, cy - 1, EYE_BLACK);
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
    case 'dig0': // 双钳一起向前下刨
      drawClaw(f, p, 4, cy + 3);
      drawClaw(f, p, 9, cy + 3);
      break;
    case 'dig1':
      drawClaw(f, p, 4, cy + 5);
      drawClaw(f, p, 9, cy + 5);
      break;
    case 'sweep0': // 双钳扫向左侧
      drawClaw(f, p, 1, cy + 2);
      drawClaw(f, p, 4, cy + 4);
      break;
    case 'sweep1': // 扫向右侧
      drawClaw(f, p, 12, cy + 2);
      drawClaw(f, p, 9, cy + 4);
      break;
    case 'juggle0':
      drawClaw(f, p, 1, cy - 6);
      drawClaw(f, p, 12, cy - 5);
      break;
    case 'juggle1':
      drawClaw(f, p, 1, cy - 5);
      drawClaw(f, p, 12, cy - 6);
      break;
  }

  // 杂技球：两颗小球在头顶交替
  if (pose.balls !== undefined) {
    const BALL = '#f0c040';
    if (pose.balls === 0) {
      f.rect(5, cy - 10, 2, 2, BALL);
      f.rect(10, cy - 12, 2, 2, BALL);
    } else {
      f.rect(5, cy - 12, 2, 2, BALL);
      f.rect(10, cy - 10, 2, 2, BALL);
    }
  }

  // 钻沙：用沙色盖掉下半身 + 两侧沙堆边
  if (pose.buried) {
    const SAND = '#f0d9a0';
    const SAND_DARK = '#dcc488';
    f.rect(0, cy + 1, F, F - cy - 1, SAND);
    f.rect(2, cy + 1, 12, 1, SAND_DARK);
    f.px(1, cy, SAND_DARK);
    f.px(14, cy, SAND_DARK);
  }
}

const png = new PNG({
  width: POSES.length * F,
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
  digging: { frames: [14, 15], fps: 3 },
  burrow: { frames: [16, 17], fps: 0.8 },
  error: { frames: [18, 19], fps: 2 },
  compact: { frames: [20, 21], fps: 3 },
  juggle: { frames: [22, 23], fps: 4 },
} as const;
export type CrabAnimName = keyof typeof CRAB_ANIM;
`;
fs.writeFileSync(path.join(outDir, 'crabFrames.ts'), framesTs);
console.log(`sprites written → ${outDir} (${png.width}×${png.height})`);
