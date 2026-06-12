/**
 * 用 sprite sheet 第一帧（橙蟹 idle）最近邻放大生成 app 图标。
 * 输出 build/icon-1024.png，再由 npm 脚本走 sips+iconutil 出 icns（见 README）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const F = 16;
const OUT = 1024;
const PAD = 96; // 四周留白，图标不顶边

const sheetPath = path.join(
  import.meta.dirname,
  '../src/renderer/src/assets/crab.png',
);
const sheet = PNG.sync.read(fs.readFileSync(sheetPath));

const icon = new PNG({ width: OUT, height: OUT, colorType: 6 });
icon.data.fill(0);

// 圆角沙色底板
const bg = [240, 217, 160, 255];
const R = 180;
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    const cx = Math.max(R - x, x - (OUT - 1 - R), 0);
    const cy = Math.max(R - y, y - (OUT - 1 - R), 0);
    if (cx * cx + cy * cy > R * R) continue;
    const i = (y * OUT + x) * 4;
    icon.data[i] = bg[0];
    icon.data[i + 1] = bg[1];
    icon.data[i + 2] = bg[2];
    icon.data[i + 3] = bg[3];
  }
}

// 最近邻放大第一帧（帧 0 行 0 = 橙蟹 idle）
const scale = (OUT - PAD * 2) / F;
for (let y = 0; y < OUT - PAD * 2; y++) {
  for (let x = 0; x < OUT - PAD * 2; x++) {
    const sx = Math.floor(x / scale);
    const sy = Math.floor(y / scale);
    const si = (sy * sheet.width + sx) * 4;
    if (sheet.data[si + 3] === 0) continue;
    const di = ((y + PAD) * OUT + (x + PAD)) * 4;
    icon.data[di] = sheet.data[si];
    icon.data[di + 1] = sheet.data[si + 1];
    icon.data[di + 2] = sheet.data[si + 2];
    icon.data[di + 3] = 255;
  }
}

const outDir = path.join(import.meta.dirname, '../build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon-1024.png'), PNG.sync.write(icon));
console.log('icon written → build/icon-1024.png');

// 托盘图标：sprite 第一帧 2x 最近邻放大成 32×32（菜单栏用）
const tray = new PNG({ width: 32, height: 32, colorType: 6 });
tray.data.fill(0);
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    const si = ((y >> 1) * sheet.width + (x >> 1)) * 4;
    if (sheet.data[si + 3] === 0) continue;
    const di = (y * 32 + x) * 4;
    tray.data[di] = sheet.data[si];
    tray.data[di + 1] = sheet.data[si + 1];
    tray.data[di + 2] = sheet.data[si + 2];
    tray.data[di + 3] = 255;
  }
}
const resDir = path.join(import.meta.dirname, '../resources');
fs.mkdirSync(resDir, { recursive: true });
fs.writeFileSync(path.join(resDir, 'tray.png'), PNG.sync.write(tray));
console.log('tray icon written → resources/tray.png');
