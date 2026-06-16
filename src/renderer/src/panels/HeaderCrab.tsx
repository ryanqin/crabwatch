import { useEffect, useRef } from 'react';
import crabPng from '../assets/crab.png';

/**
 * roster 头部那只活的橙色像素蟹：在加高的头部条里慢悠悠左右踱步，沿用沙滩同款精灵
 * （走 frames 2-5 / 歇 0-1 / 偶尔挖沙 14-15），边缘转向。精灵默认朝右、朝左时水平翻转
 * （与 CanvasMap 的 `facingLeft → scale(-1,1)` 一致）。慢速 + 长停顿，保持安静基调。
 */
const FRAME = 16; // 单帧像素
const SCALE = 2; // 16 → 32px
const COLOR_ROW = 0; // 橙色（品牌）
const WALK = [2, 3, 4, 5];
const IDLE = [0, 1];
const DIG = [14, 15];

export function HeaderCrab() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sheet = new Image();
    sheet.src = crabPng;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let cssW = 0;
    let cssH = 0;
    const fit = () => {
      cssW = canvas.clientWidth;
      cssH = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    let x = 30;
    let dir: 1 | -1 = 1;
    let mode: 'walk' | 'idle' | 'dig' = 'idle';
    let timeLeft = rand(1, 2.5);
    let animT = 0;
    const SPEED = 12; // px/s，慢悠悠

    const nextMode = () => {
      if (mode === 'walk') {
        // 走累了歇会儿（偶尔挖沙）
        mode = Math.random() < 0.75 ? 'idle' : 'dig';
        timeLeft = mode === 'idle' ? rand(1.6, 4) : rand(1.4, 2.4);
      } else {
        // 歇完接着走，半数概率换个方向
        mode = 'walk';
        if (Math.random() < 0.5) dir = dir === 1 ? -1 : 1;
        timeLeft = rand(2, 5);
      }
      animT = 0;
    };

    const frameOf = (frames: number[], fps: number) =>
      frames[Math.floor(animT * fps) % frames.length];

    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
      last = t;
      animT += dt;
      timeLeft -= dt;
      if (timeLeft <= 0) nextMode();

      const margin = (FRAME * SCALE) / 2 + 2;
      const maxX = Math.max(margin, cssW - margin);
      if (mode === 'walk') {
        x += SPEED * dir * dt;
        if (x <= margin) {
          x = margin;
          dir = 1;
        } else if (x >= maxX) {
          x = maxX;
          dir = -1;
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.imageSmoothingEnabled = false;
      const fi =
        mode === 'walk'
          ? frameOf(WALK, 4)
          : mode === 'dig'
            ? frameOf(DIG, 3)
            : frameOf(IDLE, 1.5);
      ctx.save();
      ctx.translate(Math.round(x), cssH - 10);
      ctx.scale(dir * SCALE, SCALE); // dir<0 → 水平翻转
      ctx.drawImage(
        sheet,
        fi * FRAME,
        COLOR_ROW * FRAME,
        FRAME,
        FRAME,
        -FRAME / 2,
        -FRAME + 4,
        FRAME,
        FRAME,
      );
      ctx.restore();
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      raf = requestAnimationFrame(loop);
    };
    if (sheet.complete) start();
    else sheet.onload = start;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="mini-crab-canvas" aria-label="crabs" />;
}
