import { useEffect, useState } from 'react';
import type { UsageSnapshot } from '../../../shared/types';

/** 相对时长表示，不碰时区 */
function resetText(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <span className="usage-bar">
      <span
        className="usage-bar-fill"
        style={{ width: `${Math.min(pct, 100)}%`, background: color }}
      />
    </span>
  );
}

export function UsageBadge() {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const u = await window.crabwatch.getUsage();
        if (alive) {
          setUsage(u);
          setFailed(u === null);
        }
      } catch {
        if (alive) setFailed(true);
      }
    }
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!usage)
    return (
      <div
        className="usage-badge dim"
        title={failed ? 'usage unavailable (keychain/network)' : 'loading'}
      >
        Usage --%
      </div>
    );
  return (
    <div
      className="usage-badge"
      title={`source: ${usage.source}${usage.planName ? ` · ${usage.planName}` : ''}`}
    >
      <span className="usage-seg">
        5h <Bar pct={usage.fiveHourPct} color="#7a9bd0" /> {usage.fiveHourPct}%{' '}
        <span className="dim">{resetText(usage.fiveHourResetAt)}</span>
      </span>
      <span className="usage-seg">
        wk <Bar pct={usage.weeklyPct} color="#7a9bd0" /> {usage.weeklyPct}%{' '}
        <span className="dim">{resetText(usage.weeklyResetAt)}</span>
      </span>
    </div>
  );
}
