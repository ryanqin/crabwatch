import { useEffect, useRef } from 'react';
import { useStore, type CrabUI } from '../state/store';
import {
  COLORS,
  MAP_H,
  MAP_W,
  SCALE,
  SEA_ROWS,
  TILE,
  randomWanderPoint,
} from './beach';
import crabPng from '../assets/crab.png';
import { CRAB_ANIM, CRAB_FRAME_SIZE, type CrabAnimName } from '../assets/crabFrames';

const SPEED = 6; // 逻辑 px/s：螃蟹悠闲地横着挪

/** 每只螃蟹的动画运行时（不进 zustand，避免 60fps 重渲染） */
interface CrabAnim {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nextWanderAt: number;
  facingLeft: boolean;
  seed: number;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function animFor(crab: CrabUI, moving: boolean): CrabAnimName {
  switch (crab.state) {
    case 'working':
      return 'typing';
    case 'thinking':
      return 'thinking';
    case 'waiting_input':
    case 'waiting_permission':
      return 'waiting';
    case 'sleeping':
      return 'sleeping';
    default:
      return moving ? 'walk' : 'idle';
  }
}

function defaultBubble(crab: CrabUI): string | undefined {
  if (crab.bubble) return crab.bubble;
  switch (crab.state) {
    case 'thinking':
      return '…';
    case 'waiting_input':
      return 'your turn';
    case 'waiting_permission':
      return '❗';
    case 'sleeping':
      return 'Zzz';
    default:
      return undefined;
  }
}

export function CanvasMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animsRef = useRef(new Map<string, CrabAnim>());

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    const sheet = new Image();
    sheet.src = crabPng;

    let raf = 0;
    let last = performance.now();
    let lastTick = 0;
    let running = true;

    /** 扁平大色块的 PICO 风沙滩，装饰极少 */
    function drawMap() {
      // 海：两条扁平色带
      ctx.fillStyle = COLORS.seaDeep;
      ctx.fillRect(0, 0, MAP_W, TILE);
      ctx.fillStyle = COLORS.sea;
      ctx.fillRect(0, TILE, MAP_W, (SEA_ROWS - 1) * TILE);
      // 厚浪沿：静态方齿轮廓（动态漂移太抢注意力）
      ctx.fillStyle = COLORS.foam;
      for (let x = -16; x < MAP_W + 16; x += 16) {
        ctx.fillRect(x, SEA_ROWS * TILE - 3, 8, 3);
        ctx.fillRect(x + 8, SEA_ROWS * TILE - 1, 8, 1);
      }
      // 沙滩：一整块平色
      ctx.fillStyle = COLORS.sand;
      ctx.fillRect(0, SEA_ROWS * TILE, MAP_W, MAP_H - SEA_ROWS * TILE);
      // 极少量粗颗粒沙点（道具都删了——认不出来的装饰=噪音）
      ctx.fillStyle = COLORS.sandShadow;
      for (const [sx, sy] of [
        [40, 70], [120, 110], [220, 60], [270, 150], [70, 160], [180, 180], [300, 90],
      ])
        ctx.fillRect(sx, sy, 3, 3);
    }

    function ensureAnim(crab: CrabUI, now: number): CrabAnim {
      let anim = animsRef.current.get(crab.sessionId);
      if (!anim) {
        const rand = mulberry(hashStr(crab.sessionId));
        const target = randomWanderPoint(rand);
        anim = {
          x: 20 + rand() * (MAP_W - 40),
          y: SEA_ROWS * TILE - 6, // 从海里爬出来
          tx: target.x,
          ty: target.y,
          nextWanderAt: now + 2000,
          facingLeft: false,
          seed: hashStr(crab.sessionId),
        };
        animsRef.current.set(crab.sessionId, anim);
      }
      return anim;
    }

    function updateAnim(
      crab: CrabUI,
      anim: CrabAnim,
      dt: number,
      now: number,
    ): boolean {
      const moveStates = ['spawning', 'idle_wander', 'exiting'];
      if (!moveStates.includes(crab.state)) return false;
      if (crab.state === 'exiting') {
        anim.tx = anim.x;
        anim.ty = SEA_ROWS * TILE - 8;
      } else if (crab.state === 'idle_wander' && now > anim.nextWanderAt) {
        const rand = mulberry(anim.seed + Math.floor(now / 1000));
        const p = randomWanderPoint(rand);
        anim.tx = p.x;
        anim.ty = p.y;
        anim.nextWanderAt = now + 5000 + rand() * 10000;
      }
      const dx = anim.tx - anim.x;
      const dy = anim.ty - anim.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) return false;
      const step = Math.min(dist, (SPEED * dt) / 1000);
      anim.x += (dx / dist) * step;
      anim.y += (dy / dist) * step;
      if (Math.abs(dx) > 1) anim.facingLeft = dx < 0;
      return true;
    }

    function drawCrabSprite(
      crab: CrabUI,
      anim: CrabAnim,
      moving: boolean,
      now: number,
    ) {
      const a = CRAB_ANIM[animFor(crab, moving)];
      const fi = a.frames[Math.floor((now / 1000) * a.fps) % a.frames.length];
      ctx.save();
      ctx.translate(Math.round(anim.x), Math.round(anim.y));
      if (anim.facingLeft) ctx.scale(-1, 1);
      if (crab.state === 'exiting') ctx.globalAlpha = 0.6;
      ctx.drawImage(
        sheet,
        fi * CRAB_FRAME_SIZE,
        crab.colorIdx * CRAB_FRAME_SIZE,
        CRAB_FRAME_SIZE,
        CRAB_FRAME_SIZE,
        -CRAB_FRAME_SIZE / 2,
        -CRAB_FRAME_SIZE + 4,
        CRAB_FRAME_SIZE,
        CRAB_FRAME_SIZE,
      );
      ctx.restore();
    }

    /** 气泡走原生分辨率，字是清晰的（粗颗粒只属于像素画本身） */
    function drawOverlay(crab: CrabUI, anim: CrabAnim) {
      const sx = anim.x * SCALE;
      const sy = anim.y * SCALE;
      const bubble = defaultBubble(crab);
      if (bubble) {
        const text = bubble.length > 16 ? bubble.slice(0, 15) + '…' : bubble;
        ctx.font = '12px ui-monospace, monospace';
        const tw = ctx.measureText(text).width;
        const bx = Math.round(sx - tw / 2 - 6);
        const by = Math.round(sy - CRAB_FRAME_SIZE * SCALE - 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx, by, tw + 12, 18);
        ctx.fillRect(Math.round(sx) - 3, by + 18, 6, 4);
        ctx.fillStyle = '#202020';
        ctx.textAlign = 'left';
        ctx.fillText(text, bx + 6, by + 13);
      }
    }

    function frame(now: number) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(now - last, 100);
      if (dt < 30) return; // ~30fps 上限
      last = now;

      const { crabs } = useStore.getState();
      if (now - lastTick > 500) {
        lastTick = now;
        useStore.getState().tick(Date.now());
        for (const id of animsRef.current.keys())
          if (!crabs[id]) animsRef.current.delete(id);
      }

      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      drawMap();
      const sorted = Object.values(crabs).sort((a, b) => {
        const aa = animsRef.current.get(a.sessionId)?.y ?? 0;
        const bb = animsRef.current.get(b.sessionId)?.y ?? 0;
        return aa - bb;
      });
      const movingMap = new Map<string, boolean>();
      for (const crab of sorted) {
        const anim = ensureAnim(crab, now);
        const moving = updateAnim(crab, anim, dt, now);
        movingMap.set(crab.sessionId, moving);
        drawCrabSprite(crab, anim, moving, now);
      }
      // 文字层：原生分辨率
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const crab of sorted)
        drawOverlay(crab, animsRef.current.get(crab.sessionId)!);
    }

    raf = requestAnimationFrame(frame);
    const onVis = () => {
      running = !document.hidden;
      if (running) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else cancelAnimationFrame(raf);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / SCALE;
    const y = (e.clientY - rect.top) / SCALE;
    let best: { id: string; d: number } | undefined;
    for (const [id, anim] of animsRef.current) {
      const d = Math.hypot(anim.x - x, anim.y - (y + 4));
      if (d < 14 && (!best || d < best.d)) best = { id, d };
    }
    useStore.getState().select(best?.id);
  }

  return (
    <canvas
      ref={canvasRef}
      width={MAP_W * SCALE}
      height={MAP_H * SCALE}
      onClick={onClick}
      style={{ imageRendering: 'pixelated', cursor: 'pointer' }}
    />
  );
}
