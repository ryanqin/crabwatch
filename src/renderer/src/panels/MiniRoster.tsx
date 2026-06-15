import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import type { CrabState } from '../../../shared/types';

/**
 * 略缩悬浮窗的内容：每个 session 一行（状态点 + 名 + context%）。独立窗，自己 init +
 * 订阅 engine 事件（App 不在这条渲染树上）。整窗可拖（-webkit-app-region: drag），
 * 行与按钮 no-drag 可点；点行通过 openMain 展开主窗并选中。
 */

// 状态 → 点：安静优先（idle/sleeping 哑灰），只有真信号才亮（活=绿 / 等输入=琥珀空心 / 等权限=红）
const STATE_DOT: Record<CrabState, { color: string; hollow: boolean }> = {
  working: { color: '#8fbf7a', hollow: false },
  thinking: { color: '#8fbf7a', hollow: false },
  waiting_input: { color: '#c79a4e', hollow: true },
  waiting_permission: { color: '#b85c5c', hollow: false },
  idle_wander: { color: '#6e7681', hollow: false },
  sleeping: { color: '#6e7681', hollow: true },
  spawning: { color: '#6e7681', hollow: false },
  exiting: { color: '#4a4f57', hollow: true },
};

/** 与 CrabRoster 同款窗口大小启发式（transcript 模型名不带 [1m] 后缀） */
function windowSize(model: string | undefined, ctxTokens: number): number {
  if (ctxTokens > 200_000) return 1_000_000;
  if (model?.startsWith('claude-fable')) return 1_000_000;
  return 200_000;
}

function barColor(pct: number): string {
  return pct >= 90 ? '#b85c5c' : pct >= 70 ? '#c79a4e' : '#a8ad5a';
}

export function MiniRoster() {
  const crabs = useStore((s) => s.crabs);
  const rootRef = useRef<HTMLDivElement>(null);

  // 独立窗自管：拉初始 session + 订阅引擎事件
  useEffect(() => {
    void window.crabwatch.init().then((s) => useStore.getState().init(s));
    return window.crabwatch.onEngineEvent((msg) =>
      useStore.getState().apply(msg),
    );
  }, []);

  const list = Object.values(crabs).sort((a, b) =>
    a.projectName.localeCompare(b.projectName),
  );

  // 量内容高度回传，main 调窗口高度跟随
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = () => window.crabwatch.reportFloatingHeight(el.offsetHeight);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [list.length]);

  return (
    <div className="mini-roster" ref={rootRef}>
      <div className="mini-head">
        <span className="mini-title">crabs</span>
        <button
          className="mini-hide"
          title="hide"
          onClick={() => void window.crabwatch.setFloating(false)}
        >
          ×
        </button>
      </div>
      {list.length === 0 && <div className="mini-empty">no active sessions</div>}
      {list.map((c) => {
        const pct =
          c.ctxTokens !== undefined
            ? Math.min(
                100,
                Math.round(
                  (c.ctxTokens / windowSize(c.model, c.ctxTokens)) * 100,
                ),
              )
            : undefined;
        const dot = STATE_DOT[c.state] ?? STATE_DOT.idle_wander;
        return (
          <button
            key={c.sessionId}
            className="mini-row"
            title={`${c.projectName} · ${c.state}${pct !== undefined ? ` · ctx ${pct}%` : ''}`}
            onClick={() => void window.crabwatch.openMain(c.sessionId)}
          >
            <span
              className="mini-dot"
              style={{
                borderColor: dot.color,
                background: dot.hollow ? 'transparent' : dot.color,
              }}
            />
            <span className="mini-name">
              {c.projectName}
              {c.remoteSource && (
                <span className="mini-remote"> ‹{c.remoteSource}›</span>
              )}
            </span>
            <span className="mini-pct">
              {pct !== undefined ? `${pct}%` : '–'}
            </span>
            <span className="mini-bar">
              <span
                className="mini-bar-fill"
                style={{ width: `${pct ?? 0}%`, background: barColor(pct ?? 0) }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
