/** 潮间带固定预设地图：上方是海，沙滩上 6 个潮池，一个项目一池 */
export const TILE = 16;
export const MAP_COLS = 40;
export const MAP_ROWS = 26;
export const SEA_ROWS = 5;
export const MAP_W = MAP_COLS * TILE;
export const MAP_H = MAP_ROWS * TILE;

export interface Pool {
  x: number; // tile 坐标
  y: number;
  w: number;
  h: number;
}

export const POOLS: Pool[] = [
  { x: 3, y: 8, w: 9, h: 6 },
  { x: 16, y: 8, w: 9, h: 6 },
  { x: 29, y: 8, w: 9, h: 6 },
  { x: 3, y: 18, w: 9, h: 6 },
  { x: 16, y: 18, w: 9, h: 6 },
  { x: 29, y: 18, w: 9, h: 6 },
];

export const COLORS = {
  seaDeep: '#1b4965',
  sea: '#2a6f97',
  seaFoam: '#bee9e8',
  sand: '#e9d8a6',
  sandDark: '#d4bd84',
  poolRim: '#b59e6e',
  poolWater: '#62b6cb',
  poolShine: '#a8dde9',
  label: '#5a4a2f',
};

export function poolForZone(zoneIdx: number): Pool {
  return POOLS[zoneIdx % POOLS.length];
}

/** 池内随机一个落点（像素坐标），带边距 */
export function randomPointInPool(pool: Pool, rand: () => number) {
  const pad = 14;
  const x = pool.x * TILE + pad + rand() * (pool.w * TILE - pad * 2);
  const y = pool.y * TILE + pad + rand() * (pool.h * TILE - pad * 2);
  return { x, y };
}
