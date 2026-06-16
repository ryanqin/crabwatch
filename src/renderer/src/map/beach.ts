/** PICO PARK 风格的开阔沙滩：扁平大色块，不分区，所有螃蟹混居 */
export const TILE = 16;
// 最小列数=beach/crab 区下限，必须够小。否则面板打开后 map-wrap 缩小，canvas 与
// crab clamp 区被这个 floor 卡住、溢出到右侧详情栏下面，把走进去的蟹「盖住」
// （20 列=1280px 是该 bug 根因：窗口<1739 时面板一开 map-wrap 就 <1280）。
export const MIN_COLS = 6;
export const MIN_ROWS = 13;
export const SEA_ROWS = 2;
/** 粗颗粒：1 个 sprite 像素 = 4 个屏幕像素 */
export const SCALE = 4;

/**
 * 画布逻辑尺寸：随容器响应式更新（CanvasMap 的 ResizeObserver 写入），绘制每帧读取。
 * w/h = 画布（整格 ceil，可比容器大，溢出被裁）；viewW/viewH = 容器可视区——
 * 螃蟹的漫步与钳制必须用可视尺寸，否则会走进被裁掉的右/底边缘「藏」起来。
 */
export const map = {
  w: MIN_COLS * TILE,
  h: MIN_ROWS * TILE,
  viewW: MIN_COLS * TILE,
  viewH: MIN_ROWS * TILE,
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

/** 螃蟹可漫游的区域（可视沙滩，留边距）——随容器可视尺寸动态计算 */
export function wanderRect() {
  return {
    x: 10,
    y: SEA_ROWS * TILE + 14,
    w: map.viewW - 20,
    h: map.viewH - SEA_ROWS * TILE - 26,
  };
}

export function randomWanderPoint(rand: () => number) {
  const r = wanderRect();
  return {
    x: r.x + rand() * r.w,
    y: r.y + rand() * r.h,
  };
}
