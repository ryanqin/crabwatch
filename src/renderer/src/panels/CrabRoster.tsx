import { useStore } from '../state/store';

/** 与 gen-sprites 的 4 色变体一致 */
const CRAB_COLORS = ['#f08030', '#e04848', '#a86ce0', '#38b0a8'];

/**
 * transcript 记录的模型名不带 [1m] 后缀，窗口大小只能启发式判断：
 * - ctx 已超 200k → 必然是 1M 窗口
 * - fable 系（用户默认开 1M）→ 1M
 * - 其余按 200k
 */
function windowSize(model: string | undefined, ctxTokens: number): number {
  if (ctxTokens > 200_000) return 1_000_000;
  // 已知 1M 模型族（用户全程 Opus 4.8 1M；transcript 不带 [1m] 后缀，判不出窗口）
  if (model && /^claude-(opus-4-8|fable)/.test(model)) return 1_000_000;
  return 200_000;
}

/** 左侧 session 列表：每只螃蟹的 context 占比 */
export function CrabRoster() {
  const crabs = useStore((s) => s.crabs);
  const hudMenuOpen = useStore((s) => s.hudMenuOpen);
  const list = Object.values(crabs).sort((a, b) =>
    a.projectName.localeCompare(b.projectName),
  );
  if (list.length === 0 || hudMenuOpen) return null;

  return (
    <div className="roster">
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
        return (
          <button
            key={c.sessionId}
            className="roster-row"
            onClick={() => useStore.getState().select(c.sessionId)}
            title={`${c.projectName} · ${c.state}${pct !== undefined ? ` · ctx ${pct}%` : ''}`}
          >
            <span
              className="roster-dot"
              style={{ background: CRAB_COLORS[c.colorIdx % 4] }}
            />
            <span className="roster-name">{c.projectName}</span>
            <span className="roster-bar">
              <span
                className="roster-bar-fill"
                style={{
                  width: `${pct ?? 0}%`,
                  // 跟 claude-hud 同款阈值：<70 橄榄黄，≥70 琥珀，≥90 哑红。
                  // 走主题变量：白天版调深、浅底上对比够；黑夜版仍原色。
                  background:
                    (pct ?? 0) >= 90
                      ? 'var(--red)'
                      : (pct ?? 0) >= 70
                        ? 'var(--amber)'
                        : 'var(--olive)',
                }}
              />
            </span>
            <span className="roster-pct">
              {pct !== undefined ? `${pct}%` : '–'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
