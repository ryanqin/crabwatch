import { useEffect, useRef, useState } from 'react';
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
import propsPng from '../assets/props.png';
import { CRAB_ANIM, CRAB_FRAME_SIZE, type CrabAnimName } from '../assets/crabFrames';

/** props.png 里的道具索引 × 摆放位置（逻辑 px，稀疏静态，不抢注意力） */
const PROP_SPOTS: [number, number, number][] = [
  [1, 24, 36], // 棕榈树（树荫在海边）
  [0, 268, 44], // 遮阳伞
  [2, 46, 148], // 水桶
  [3, 248, 158], // 海星
  [4, 158, 184], // 贝壳
];

const SPEED = 6; // 逻辑 px/s：螃蟹悠闲地横着挪
/** 螃蟹活动的上界：只在沙滩上，不进浪线（顶部还压着 nav bar，点不到） */
const BEACH_TOP = SEA_ROWS * TILE + 12;

/** idle 时的沙滩小动作 */
interface BeachAction {
  kind: 'digging' | 'burrow' | 'bubble';
  started: number;
  until: number;
}

/** 每只螃蟹的动画运行时（不进 zustand，避免 60fps 重渲染） */
interface CrabAnim {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nextWanderAt: number;
  facingLeft: boolean;
  seed: number;
  action?: BeachAction;
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

/** 钉在沙滩范围内（渲染循环和拖拽共用） */
function clampAnim(anim: { x: number; y: number }) {
  anim.x = Math.min(Math.max(anim.x, 10), MAP_W - 10);
  anim.y = Math.min(Math.max(anim.y, BEACH_TOP), MAP_H - 12);
}

function animFor(crab: CrabUI, moving: boolean): CrabAnimName {
  // 短暂特效优先：出错晕眩 / compact 扫地
  if (crab.flash && crab.flash.until > Date.now())
    return crab.flash.kind === 'error' ? 'error' : 'compact';
  switch (crab.state) {
    case 'working':
      // 有 subagent 在跑 = 多线操作，耍杂技
      return (crab.subagentCount ?? 0) > 0 ? 'juggle' : 'typing';
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
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const hoverCrab = useStore((s) => (hover ? s.crabs[hover.id] : undefined));

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    const sheet = new Image();
    sheet.src = crabPng;
    const props = new Image();
    props.src = propsPng;

    let raf = 0;
    let last = performance.now();
    let lastTick = 0;
    let running = true;

    /** 扁平大色块的 PICO 风沙滩，装饰极少 */
    function drawMap() {
      // 海：一整块平色
      ctx.fillStyle = COLORS.sea;
      ctx.fillRect(0, 0, MAP_W, SEA_ROWS * TILE);
      // 厚浪沿：静态方齿轮廓（动态漂移太抢注意力）
      ctx.fillStyle = COLORS.foam;
      for (let x = -16; x < MAP_W + 16; x += 16) {
        ctx.fillRect(x, SEA_ROWS * TILE - 3, 8, 3);
        ctx.fillRect(x + 8, SEA_ROWS * TILE - 1, 8, 1);
      }
      // 沙滩：一整块平色
      ctx.fillStyle = COLORS.sand;
      ctx.fillRect(0, SEA_ROWS * TILE, MAP_W, MAP_H - SEA_ROWS * TILE);
      // 极少量粗颗粒沙点
      ctx.fillStyle = COLORS.sandShadow;
      for (const [sx, sy] of [
        [40, 70], [120, 110], [220, 60], [270, 150], [70, 160], [180, 180], [300, 90],
      ])
        ctx.fillRect(sx, sy, 3, 3);
      // 沙滩道具（静态）
      for (const [idx, px, py] of PROP_SPOTS)
        ctx.drawImage(props, idx * 16, 0, 16, 16, px, py, 16, 16);
    }

    /** 选漫步目标时避开其他螃蟹，名牌不重叠 */
    function pickWanderTarget(rand: () => number, selfId: string) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const p = randomWanderPoint(rand);
        let ok = true;
        for (const [id, other] of animsRef.current) {
          if (id === selfId) continue;
          if (Math.hypot(other.x - p.x, other.y - p.y) < 36) {
            ok = false;
            break;
          }
        }
        if (ok) return p;
      }
      return randomWanderPoint(rand);
    }

    /** 安全距离：靠太近的螃蟹轻轻互推开 */
    function separate(ids: string[], dt: number) {
      const MIN = 26;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = animsRef.current.get(ids[i]);
          const b = animsRef.current.get(ids[j]);
          if (!a || !b) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d >= MIN) continue;
          if (d < 0.01) {
            dx = 1;
            dy = 0;
            d = 1;
          }
          const push = Math.min(((MIN - d) / MIN) * ((14 * dt) / 1000), MIN - d);
          a.x -= (dx / d) * (push / 2);
          a.y -= (dy / d) * (push / 2);
          b.x += (dx / d) * (push / 2);
          b.y += (dy / d) * (push / 2);
          clampAnim(a);
          clampAnim(b);
        }
      }
    }

    function ensureAnim(crab: CrabUI, now: number): CrabAnim {
      let anim = animsRef.current.get(crab.sessionId);
      if (!anim) {
        const rand = mulberry(hashStr(crab.sessionId));
        const target = pickWanderTarget(rand, crab.sessionId);
        anim = {
          x: 20 + rand() * (MAP_W - 40),
          y: BEACH_TOP, // 从滩沿登场，全程可点
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
      // 还没上岸的螃蟹必须先走上沙滩，不管逻辑状态是什么（卡在海里会点不到）
      const ashore = anim.y >= SEA_ROWS * TILE + 10;
      if (!moveStates.includes(crab.state) && ashore) return false;
      // 沙滩小动作期间原地不动；状态切走或到时则结束
      if (anim.action && (crab.state !== 'idle_wander' || now > anim.action.until))
        anim.action = undefined;
      if (anim.action) return false;

      if (crab.state === 'exiting') {
        anim.tx = anim.x;
        anim.ty = BEACH_TOP; // 走到滩沿淡出
      } else if (crab.state === 'idle_wander' && now > anim.nextWanderAt) {
        const rand = mulberry(anim.seed + Math.floor(now / 1000));
        if (rand() < 0.45) {
          // 做个沙滩日常：挖沙 / 钻沙 / 吐泡泡
          const kinds: BeachAction['kind'][] = ['digging', 'burrow', 'bubble'];
          const kind = kinds[Math.floor(rand() * kinds.length)];
          const dur = 3000 + rand() * 4000;
          anim.action = { kind, started: now, until: now + dur };
          anim.nextWanderAt = now + dur + 2000 + rand() * 4000;
          return false;
        }
        const p = pickWanderTarget(rand, crab.sessionId);
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
      clampAnim(anim);
      if (Math.abs(dx) > 1) anim.facingLeft = dx < 0;
      return true;
    }

    function drawCrabSprite(
      crab: CrabUI,
      anim: CrabAnim,
      moving: boolean,
      now: number,
    ) {
      const action =
        crab.state === 'idle_wander' && anim.action ? anim.action : undefined;
      const animName =
        action && action.kind !== 'bubble' ? action.kind : animFor(crab, moving);
      const a = CRAB_ANIM[animName];
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
      if (action) drawActionParticles(action, anim, now);
    }

    /** 动作粒子：挖沙的沙粒 / 吐泡泡的上浮气泡（钻沙的沙堆在 sprite 里） */
    function drawActionParticles(action: BeachAction, anim: CrabAnim, now: number) {
      const x = Math.round(anim.x);
      const y = Math.round(anim.y);
      if (action.kind === 'digging') {
        const ph = Math.floor(now / 160) % 2;
        ctx.fillStyle = '#c9b078';
        ctx.fillRect(x - 6 - ph, y + 1 + ph, 2, 2);
        ctx.fillRect(x + 5 + ph, y + 2 - ph, 2, 2);
      } else if (action.kind === 'bubble') {
        const t = now - action.started;
        const rise1 = (t / 260) % 14;
        const rise2 = (t / 340 + 7) % 14;
        ctx.fillStyle = '#dceefb';
        ctx.globalAlpha = 0.9 - rise1 / 18;
        ctx.fillRect(x + 5, y - 11 - rise1, 2, 2);
        ctx.globalAlpha = 0.9 - rise2 / 18;
        ctx.fillRect(x + 8, y - 9 - rise2, 1, 1);
        ctx.globalAlpha = 1;
      }
    }

    /** 名牌 + 气泡走原生分辨率，字是清晰的（粗颗粒只属于像素画本身）。
     *  坐标必须和精灵同样先取整再放大，否则字会比螃蟹滑得细、产生跟随感。 */
    function drawOverlay(crab: CrabUI, anim: CrabAnim) {
      const sx = Math.round(anim.x) * SCALE;
      const sy = Math.round(anim.y) * SCALE;
      // cwd 目录名名牌（学 clawd-on-desk：不同目录开的 session 名字有区分度）
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.label;
      ctx.fillText(crab.projectName, sx, sy + 22);
      const bubble = defaultBubble(crab);
      if (bubble) {
        const text = bubble.length > 16 ? bubble.slice(0, 15) + '…' : bubble;
        ctx.font = '13px ui-monospace, monospace';
        const tw = ctx.measureText(text).width;
        const bx = Math.round(sx - tw / 2 - 6);
        const by = Math.round(sy - CRAB_FRAME_SIZE * SCALE - 6);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx, by, tw + 12, 20);
        ctx.fillRect(Math.round(sx) - 3, by + 20, 6, 4);
        ctx.fillStyle = '#202020';
        ctx.textAlign = 'left';
        ctx.fillText(text, bx + 6, by + 14);
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
        movingMap.set(crab.sessionId, updateAnim(crab, anim, dt, now));
      }
      separate(
        sorted.map((c) => c.sessionId),
        dt,
      );
      for (const crab of sorted)
        drawCrabSprite(
          crab,
          animsRef.current.get(crab.sessionId)!,
          movingMap.get(crab.sessionId)!,
          now,
        );
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

  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);

  function toLogical(e: React.MouseEvent<HTMLCanvasElement>) {
    // canvas 会被 CSS 缩放到适配剩余空间，比例从实际渲染尺寸反推
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (MAP_W / rect.width),
      y: (e.clientY - rect.top) * (MAP_H / rect.height),
    };
  }

  function hitTest(e: React.MouseEvent<HTMLCanvasElement>): string | undefined {
    const { x, y } = toLogical(e);
    let best: { id: string; d: number } | undefined;
    for (const [id, anim] of animsRef.current) {
      const d = Math.hypot(anim.x - x, anim.y - (y + 4));
      if (d < 14 && (!best || d < best.d)) best = { id, d };
    }
    return best?.id;
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const id = hitTest(e);
    if (id) dragRef.current = { id, moved: false };
  }

  function onMouseUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    // 没怎么动 = 点击：打开面板；拖过 = 放下，不弹面板
    if (drag && !drag.moved) useStore.getState().select(drag.id);
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (drag) {
      const anim = animsRef.current.get(drag.id);
      if (anim) {
        const { x, y } = toLogical(e);
        if (Math.hypot(anim.x - x, anim.y - (y + 4)) > 2.5) drag.moved = true;
        anim.x = x;
        anim.y = y + 4;
        clampAnim(anim);
        // 放下后原地待一会儿，别立刻走掉
        anim.tx = anim.x;
        anim.ty = anim.y;
        anim.nextWanderAt = performance.now() + 5000;
        // hover 信息卡跟着拖拽走
        setHover({ id: drag.id, x: e.clientX, y: e.clientY });
      }
      return;
    }
    const id = hitTest(e);
    setHover((prev) => {
      if (!id) return prev ? null : prev;
      if (prev?.id === id) return prev;
      return { id, x: e.clientX, y: e.clientY };
    });
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        width={MAP_W * SCALE}
        height={MAP_H * SCALE}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(null);
          dragRef.current = null;
        }}
        style={{
          imageRendering: 'pixelated',
          cursor: 'pointer',
          maxWidth: '100%',
          maxHeight: '100%',
        }}
      />
      {hover && hoverCrab && (
        <div className="crab-tooltip" style={{ left: hover.x, top: hover.y }}>
          <div className="tooltip-name">
            🦀 {hoverCrab.projectName}{' '}
            <span className="dim">#{hoverCrab.sessionId.slice(0, 8)}</span>
          </div>
          <div>
            {hoverCrab.model?.replace(/^claude-/, '') ?? 'model –'}
            {hoverCrab.effort ? ` · effort ${hoverCrab.effort}` : ''}
            {hoverCrab.version ? ` · v${hoverCrab.version}` : ''}
          </div>
        </div>
      )}
    </>
  );
}
