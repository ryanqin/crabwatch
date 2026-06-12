import { useEffect, useRef } from 'react';
import { useStore, type CrabUI } from '../state/store';
import {
  COLORS,
  MAP_H,
  MAP_W,
  POOLS,
  SEA_ROWS,
  TILE,
  poolForZone,
  randomPointInPool,
} from './beach';
import crabPng from '../assets/crab.png';
import { CRAB_ANIM, CRAB_FRAME_SIZE, type CrabAnimName } from '../assets/crabFrames';

const SCALE = 2;
const SPEED = 22; // px/s

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
      return '等你输入';
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

    function drawMap(now: number) {
      // 海
      ctx.fillStyle = COLORS.seaDeep;
      ctx.fillRect(0, 0, MAP_W, 2 * TILE);
      ctx.fillStyle = COLORS.sea;
      ctx.fillRect(0, 2 * TILE, MAP_W, (SEA_ROWS - 2) * TILE);
      // 浪线（缓慢漂移）
      ctx.fillStyle = COLORS.seaFoam;
      const drift = Math.floor(now / 400) % (TILE * 2);
      for (let x = -TILE * 2; x < MAP_W; x += TILE * 2) {
        ctx.fillRect(x + drift, SEA_ROWS * TILE - 3, TILE, 2);
        ctx.fillRect(x + drift + TILE, 3 * TILE, 10, 2);
      }
      // 沙滩
      ctx.fillStyle = COLORS.sand;
      ctx.fillRect(0, SEA_ROWS * TILE, MAP_W, MAP_H - SEA_ROWS * TILE);
      ctx.fillStyle = COLORS.sandDark;
      for (let ty = SEA_ROWS; ty < 26; ty++)
        for (let tx = 0; tx < 40; tx++)
          if ((tx * 7 + ty * 13) % 11 === 0)
            ctx.fillRect(tx * TILE + ((tx * 5) % 13), ty * TILE + ((ty * 3) % 13), 2, 2);
      // 潮池
      for (const pool of POOLS) {
        const px = pool.x * TILE;
        const py = pool.y * TILE;
        const pw = pool.w * TILE;
        const ph = pool.h * TILE;
        ctx.fillStyle = COLORS.poolRim;
        ctx.fillRect(px - 3, py - 3, pw + 6, ph + 6);
        ctx.fillStyle = COLORS.poolWater;
        ctx.fillRect(px, py, pw, ph);
        ctx.fillStyle = COLORS.poolShine;
        for (let i = 0; i < 6; i++)
          ctx.fillRect(
            px + ((i * 53 + pool.x * 17) % (pw - 12)) + 6,
            py + ((i * 37 + pool.y * 11) % (ph - 8)) + 4,
            6,
            2,
          );
      }
    }

    function drawLabels(zoneOrder: string[], crabs: Record<string, CrabUI>) {
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      zoneOrder.forEach((slug, i) => {
        const pool = poolForZone(i);
        const name =
          Object.values(crabs).find((c) => c.projectSlug === slug)?.projectName ??
          '';
        if (!name) return;
        ctx.fillStyle = COLORS.label;
        ctx.fillText(
          name,
          pool.x * TILE + (pool.w * TILE) / 2,
          pool.y * TILE - 8,
        );
      });
    }

    function ensureAnim(crab: CrabUI, zoneIdx: number, now: number): CrabAnim {
      let anim = animsRef.current.get(crab.sessionId);
      if (!anim) {
        const rand = mulberry(hashStr(crab.sessionId));
        const pool = poolForZone(zoneIdx);
        const target = randomPointInPool(pool, rand);
        anim = {
          x: pool.x * TILE + (pool.w * TILE) / 2 + (rand() - 0.5) * 40,
          y: SEA_ROWS * TILE - 10, // 从海里爬出来
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
      zoneIdx: number,
      dt: number,
      now: number,
    ): boolean {
      const moveStates = ['spawning', 'idle_wander', 'exiting'];
      if (!moveStates.includes(crab.state)) return false;
      if (crab.state === 'exiting') {
        anim.tx = anim.x;
        anim.ty = SEA_ROWS * TILE - 14;
      } else if (crab.state === 'idle_wander' && now > anim.nextWanderAt) {
        const rand = mulberry(anim.seed + Math.floor(now / 1000));
        const p = randomPointInPool(poolForZone(zoneIdx), rand);
        anim.tx = p.x;
        anim.ty = p.y;
        anim.nextWanderAt = now + 2500 + rand() * 6000;
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

    function drawCrab(crab: CrabUI, anim: CrabAnim, moving: boolean, now: number) {
      const a = CRAB_ANIM[animFor(crab, moving)];
      const fi =
        a.frames[Math.floor((now / 1000) * a.fps) % a.frames.length];
      ctx.save();
      ctx.translate(Math.round(anim.x), Math.round(anim.y));
      if (anim.facingLeft) ctx.scale(-1, 1);
      const exiting = crab.state === 'exiting';
      if (exiting) ctx.globalAlpha = 0.6;
      ctx.drawImage(
        sheet,
        fi * CRAB_FRAME_SIZE,
        crab.colorIdx * CRAB_FRAME_SIZE,
        CRAB_FRAME_SIZE,
        CRAB_FRAME_SIZE,
        -CRAB_FRAME_SIZE / 2,
        -CRAB_FRAME_SIZE + 8,
        CRAB_FRAME_SIZE,
        CRAB_FRAME_SIZE,
      );
      ctx.restore();

      const bubble = defaultBubble(crab);
      if (bubble) {
        ctx.font = '8px monospace';
        const text = bubble.length > 14 ? bubble.slice(0, 13) + '…' : bubble;
        const tw = ctx.measureText(text).width;
        const bx = Math.round(anim.x - tw / 2 - 4);
        const by = Math.round(anim.y - CRAB_FRAME_SIZE - 6);
        ctx.fillStyle = 'rgba(253,246,227,0.92)';
        ctx.fillRect(bx, by, tw + 8, 12);
        ctx.fillStyle = '#2b2b2b';
        ctx.textAlign = 'left';
        ctx.fillText(text, bx + 4, by + 9);
        // 小尾巴
        ctx.fillStyle = 'rgba(253,246,227,0.92)';
        ctx.fillRect(Math.round(anim.x) - 1, by + 12, 3, 3);
      }
    }

    function frame(now: number) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(now - last, 100);
      if (dt < 30) return; // ~30fps 上限
      last = now;

      const { crabs, zoneOrder } = useStore.getState();
      if (now - lastTick > 500) {
        lastTick = now;
        useStore.getState().tick(Date.now());
        // 清理已移除螃蟹的动画状态
        for (const id of animsRef.current.keys())
          if (!crabs[id]) animsRef.current.delete(id);
      }

      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      drawMap(now);
      drawLabels(zoneOrder, crabs);
      // 按 y 排序画（近的盖远的）
      const sorted = Object.values(crabs).sort((a, b) => {
        const aa = animsRef.current.get(a.sessionId)?.y ?? 0;
        const bb = animsRef.current.get(b.sessionId)?.y ?? 0;
        return aa - bb;
      });
      for (const crab of sorted) {
        const zoneIdx = Math.max(0, zoneOrder.indexOf(crab.projectSlug));
        const anim = ensureAnim(crab, zoneIdx, now);
        const moving = updateAnim(crab, anim, zoneIdx, dt, now);
        drawCrab(crab, anim, moving, now);
      }
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
      const d = Math.hypot(anim.x - x, anim.y - (y + 8));
      if (d < 20 && (!best || d < best.d)) best = { id, d };
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
