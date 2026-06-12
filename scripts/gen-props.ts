/**
 * 沙滩道具 sprite：每个 16×16，ASCII 像素图手摆，保证 4x 放大后认得出。
 * 输出 src/renderer/src/assets/props.png（横排：伞/棕榈/水桶/海星/贝壳）
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const F = 16;

const PALETTE: Record<string, string> = {
  '.': '', // 透明
  K: '#3a2a18', // 深轮廓/树干暗部
  R: '#e04848', // 伞红
  W: '#fff4e0', // 伞白
  P: '#8a6a48', // 杆/木
  G: '#3f9e4d', // 叶绿
  g: '#2e7a3a', // 叶绿暗
  T: '#a0764e', // 树干
  Y: '#f0c040', // 桶黄
  y: '#c89a28', // 桶黄暗
  O: '#f2845c', // 海星橙
  o: '#c45f3c', // 海星暗
  S: '#f0b8c8', // 贝壳粉
  s: '#c888a0', // 贝壳粉暗
};

// 遮阳伞
const UMBRELLA = [
  '......KK........',
  '...KKKRRKKK.....',
  '..KRRWWRRWWK....',
  '.KRRWWRRWWRRK...',
  '.KWWRRWWRRWWK...',
  '.KKKKKKKKKKKK...',
  '......KP........',
  '......KP........',
  '......KP........',
  '......KP........',
  '......KP........',
  '......KP........',
  '.....KPPK.......',
  '................',
  '................',
  '................',
];

// 棕榈树
const PALM = [
  '....GGG..GGG....',
  '..GGgggGGgggGG..',
  '.GggGGGggGGGggG.',
  '.Gg..GgggG...gG.',
  '......KTK.......',
  '......KTK.......',
  '.....KTTK.......',
  '.....KTK........',
  '.....KTTK.......',
  '....KTTK........',
  '....KTTK........',
  '....KTTTK.......',
  '...KKTTTKK......',
  '................',
  '................',
  '................',
];

// 水桶（带提手）
const BUCKET = [
  '................',
  '....KKKKKK......',
  '...K......K.....',
  '..K........K....',
  '..KYYYYYYYYK....',
  '..KYyyyyyyYK....',
  '..KYYYYYYYYK....',
  '...KYYYYYYK.....',
  '...KYYYYYYK.....',
  '...KyyyyyyK.....',
  '....KKKKKK......',
  '................',
  '................',
  '................',
  '................',
  '................',
];

// 海星（五角）
const STARFISH = [
  '................',
  '.......O........',
  '......OOO.......',
  '......OOO.......',
  '.OOOOOOOOOOOOO..',
  '..OOOOoooOOOO...',
  '...OOOoooOOO....',
  '....OOOOOOO.....',
  '....OOO.OOO.....',
  '...OOO...OOO....',
  '..OO.......OO...',
  '................',
  '................',
  '................',
  '................',
  '................',
];

// 贝壳（扇形）
const SHELL = [
  '................',
  '................',
  '....KKKKKK......',
  '...KSSSSSSK.....',
  '..KSsSSsSSsK....',
  '..KSsSSsSSsK....',
  '..KSsSSsSSsK....',
  '...KSsSsSsK.....',
  '....KSsSsK......',
  '.....KKKK.......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const PROPS = [UMBRELLA, PALM, BUCKET, STARFISH, SHELL];

function hex(c: string): [number, number, number] {
  return [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
}

const png = new PNG({ width: PROPS.length * F, height: F, colorType: 6 });
png.data.fill(0);
PROPS.forEach((rows, idx) => {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = PALETTE[ch];
      if (!color) return;
      const [r, g, b] = hex(color);
      const i = (y * png.width + idx * F + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    });
  });
});

const outDir = path.join(import.meta.dirname, '../src/renderer/src/assets');
fs.writeFileSync(path.join(outDir, 'props.png'), PNG.sync.write(png));
console.log(`props written → ${outDir}/props.png (${png.width}×${png.height})`);
