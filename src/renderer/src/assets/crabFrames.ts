// 由 scripts/gen-sprites.ts 生成，勿手改
export const CRAB_FRAME_SIZE = 16;
export const CRAB_COLORS = 4;
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
  clap: { frames: [24, 25], fps: 3 },
  jump: { frames: [26, 27], fps: 2.5 },
} as const;
export type CrabAnimName = keyof typeof CRAB_ANIM;
