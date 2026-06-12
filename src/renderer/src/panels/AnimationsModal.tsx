import { useEffect, useRef, useState } from 'react';
import crabPng from '../assets/crab.png';
import { CRAB_ANIM, CRAB_FRAME_SIZE } from '../assets/crabFrames';
import { ALL_ACTIONS, enabledActions } from '../map/CanvasMap';
import type { CrabAnimName } from '../assets/crabFrames';

const CELL_SCALE = 3;

/** 单格：循环播放一个动画（bubble 特殊 = idle + 泡泡粒子） */
function AnimCell({
  name,
  colorIdx,
}: {
  name: CrabAnimName | 'bubble';
  colorIdx: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const img = new Image();
    img.src = crabPng;
    const anim = name === 'bubble' ? CRAB_ANIM.idle : CRAB_ANIM[name];
    let raf = 0;
    function draw(now: number) {
      raf = requestAnimationFrame(draw);
      if (!img.complete) return;
      const fi =
        anim.frames[Math.floor((now / 1000) * anim.fps) % anim.frames.length];
      ctx.setTransform(CELL_SCALE, 0, 0, CELL_SCALE, 0, 0);
      ctx.clearRect(0, 0, CRAB_FRAME_SIZE + 4, CRAB_FRAME_SIZE + 4);
      ctx.drawImage(
        img,
        fi * CRAB_FRAME_SIZE,
        colorIdx * CRAB_FRAME_SIZE,
        CRAB_FRAME_SIZE,
        CRAB_FRAME_SIZE,
        2,
        2,
        CRAB_FRAME_SIZE,
        CRAB_FRAME_SIZE,
      );
      if (name === 'bubble') {
        const rise = (now / 260) % 12;
        ctx.fillStyle = '#dceefb';
        ctx.fillRect(13, 6 - rise / 4, 2, 2);
        ctx.fillRect(15, 9 - rise / 3, 1, 1);
      }
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [name, colorIdx]);
  const px = (CRAB_FRAME_SIZE + 4) * CELL_SCALE;
  return (
    <canvas
      ref={ref}
      width={px}
      height={px}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

const STATE_ANIMS: { name: CrabAnimName; label: string }[] = [
  { name: 'idle', label: 'idle' },
  { name: 'walk', label: 'walk' },
  { name: 'typing', label: 'working' },
  { name: 'thinking', label: 'thinking' },
  { name: 'waiting', label: 'waiting you' },
  { name: 'sleeping', label: 'sleeping' },
  { name: 'error', label: 'error' },
  { name: 'compact', label: 'compacting' },
  { name: 'juggle', label: 'subagents' },
];

const ACTION_LABELS: Record<string, string> = {
  digging: 'dig',
  burrow: 'burrow',
  bubble: 'bubbles',
  clap: 'clap',
  jump: 'jump',
};

/** 动画 gallery：状态动画展示 + idle 动作池开关（学 clawd 的主题可调感） */
export function AnimationsModal({ onClose }: { onClose: () => void }) {
  const [colorIdx, setColorIdx] = useState(0);
  const [actions, setActions] = useState<string[]>(() => enabledActions());

  function toggleAction(kind: string) {
    const next = actions.includes(kind)
      ? actions.filter((k) => k !== kind)
      : [...actions, kind];
    setActions(next);
    localStorage.setItem('cw-actions', JSON.stringify(next));
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal anims-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <span>
            animations{' '}
            <span className="anims-swatches">
              {['#f08030', '#e04848', '#a86ce0', '#38b0a8'].map((c, i) => (
                <button
                  key={c}
                  className={`anims-swatch ${i === colorIdx ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColorIdx(i)}
                />
              ))}
            </span>
          </span>
          <button onClick={onClose}>×</button>
        </header>
        <div className="anims-body">
          <div className="anims-section dim">states</div>
          <div className="anims-grid">
            {STATE_ANIMS.map((a) => (
              <div key={a.name} className="anims-cell">
                <AnimCell name={a.name} colorIdx={colorIdx} />
                <div className="anims-label">{a.label}</div>
              </div>
            ))}
          </div>
          <div className="anims-section dim">
            beach actions ▪ toggle which ones crabs do while idle
          </div>
          <div className="anims-grid">
            {ALL_ACTIONS.map((k) => (
              <button
                key={k}
                className={`anims-cell anims-toggle ${actions.includes(k) ? '' : 'off'}`}
                onClick={() => toggleAction(k)}
              >
                <AnimCell name={k as CrabAnimName | 'bubble'} colorIdx={colorIdx} />
                <div className="anims-label">
                  {actions.includes(k) ? '✓' : '✗'} {ACTION_LABELS[k]}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
