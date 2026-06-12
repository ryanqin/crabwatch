/** PICO PARK 风格的开阔沙滩：扁平大色块，不分区，所有螃蟹混居 */
export const TILE = 16;
export const MAP_COLS = 20;
export const MAP_ROWS = 13;
export const SEA_ROWS = 2;
/** 粗颗粒：1 个 sprite 像素 = 4 个屏幕像素 */
export const SCALE = 4;
export const MAP_W = MAP_COLS * TILE;
export const MAP_H = MAP_ROWS * TILE;

export const COLORS = {
  seaDeep: '#2f7fb8',
  sea: '#4aa3df',
  foam: '#ffffff',
  sand: '#f0d9a0',
  sandShadow: '#dcc488',
  rock: '#9a948c',
  rockDark: '#5f5a52',
  star: '#f2845c',
  starDark: '#c45f3c',
  label: '#6b5b43',
};

/** 螃蟹可漫游的区域（整片沙滩，留边距） */
export const WANDER = {
  x: 10,
  y: SEA_ROWS * TILE + 14,
  w: MAP_W - 20,
  h: MAP_H - SEA_ROWS * TILE - 26,
};

export function randomWanderPoint(rand: () => number) {
  return {
    x: WANDER.x + rand() * WANDER.w,
    y: WANDER.y + rand() * WANDER.h,
  };
}
