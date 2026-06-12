import { useState } from 'react';

/** 侧栏横向拖拽调宽：grow 指面板向哪个方向变宽（左栏向右拖变宽=right） */
export function useDragWidth(
  storageKey: string,
  initial: number,
  grow: 'left' | 'right',
) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved >= 320 ? saved : initial;
  });

  function onDragStart(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const raw = grow === 'right' ? startW + dx : startW - dx;
      const max = Math.max(360, window.innerWidth - 240);
      setWidth(Math.min(Math.max(raw, 320), max));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setWidth((cur) => {
        localStorage.setItem(storageKey, String(cur));
        return cur;
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  return [width, onDragStart] as const;
}
