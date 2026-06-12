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
} as const;
export type CrabAnimName = keyof typeof CRAB_ANIM;
