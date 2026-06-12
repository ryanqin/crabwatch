/** PICO PARK 风格的开阔沙滩：扁平大色块，不分区，所有螃蟹混居 */
export const TILE = 16;
export const MIN_COLS = 20;
export const MIN_ROWS = 13;
export const SEA_ROWS = 2;
/** 粗颗粒：1 个 sprite 像素 = 4 个屏幕像素 */
export const SCALE = 4;

/** 画布逻辑尺寸：随容器响应式更新（CanvasMap 的 ResizeObserver 写入），绘制每帧读取 */
export const map = {
  w: MIN_COLS * TILE,
  h: MIN_ROWS * TILE,
};

export const COLORS = {
  sea: '#5a8cb8',
  foam: '#ffffff',
  sand: '#f0d9a0',
  sandShadow: '#dcc488',
  rock: '#9a948c',
  rockDark: '#5f5a52',
  star: '#f2845c',
  starDark: '#c45f3c',
  label: '#6b5b43',
};

/** 螃蟹可漫游的区域（整片沙滩，留边距）——随 map 尺寸动态计算 */
export function wanderRect() {
  return {
    x: 10,
    y: SEA_ROWS * TILE + 14,
    w: map.w - 20,
    h: map.h - SEA_ROWS * TILE - 26,
  };
}

export function randomWanderPoint(rand: () => number) {
  const r = wanderRect();
  return {
    x: r.x + rand() * r.w,
    y: r.y + rand() * r.h,
  };
}
