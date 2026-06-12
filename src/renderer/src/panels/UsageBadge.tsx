import { useEffect, useState } from 'react';
import type { UsageSnapshot } from '../../../shared/types';

function untilText(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h >= 48) return `↻${Math.floor(h / 24)}d${h % 24}h`;
  if (h > 0) return `↻${h}h${m}m`;
  return `↻${m}m`;
}

function Bar({ pct }: { pct: number }) {
  return (
    <span className="usage-bar">
      <span className="usage-bar-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
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
      <div className="usage-badge dim" title={failed ? '取不到用量（Keychain/网络）' : '加载中'}>
        Usage --%
      </div>
    );
  return (
    <div className="usage-badge" title={`来源: ${usage.source}${usage.planName ? ` · ${usage.planName}` : ''}`}>
      <span className="usage-seg">
        5h <Bar pct={usage.fiveHourPct} /> {usage.fiveHourPct}%{' '}
        <span className="dim">{untilText(usage.fiveHourResetAt)}</span>
      </span>
      <span className="usage-seg">
        周 <Bar pct={usage.weeklyPct} /> {usage.weeklyPct}%{' '}
        <span className="dim">{untilText(usage.weeklyResetAt)}</span>
      </span>
    </div>
  );
}
