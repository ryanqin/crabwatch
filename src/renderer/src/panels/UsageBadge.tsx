import { useEffect, useState } from 'react';
import type { UsageSnapshot } from '../../../shared/types';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 直接显示重置时间点，不用心算倒计时 */
function resetText(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (d.getTime() <= Date.now()) return '';
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `↻${hhmm}`;
  return `↻${WEEKDAYS[d.getDay()]}${hhmm}`;
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
        <span className="dim">{resetText(usage.fiveHourResetAt)}</span>
      </span>
      <span className="usage-seg">
        周 <Bar pct={usage.weeklyPct} /> {usage.weeklyPct}%{' '}
        <span className="dim">{resetText(usage.weeklyResetAt)}</span>
      </span>
    </div>
  );
}
