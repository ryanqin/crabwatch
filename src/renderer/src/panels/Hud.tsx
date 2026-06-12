import { useState } from 'react';
import { useStore } from '../state/store';
import { UsageBadge } from './UsageBadge';
import type { ProjectListing } from '../../../shared/types';

export function Hud() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectListing[]>([]);

  async function toggle() {
    if (!open) setProjects(await window.crabwatch.listProjects());
    setOpen(!open);
  }

  return (
    <div className="hud">
      <div className="hud-row">
        <UsageBadge />
        <button className="hud-btn" onClick={() => void toggle()}>
          📋 任务时间线 {open ? '▴' : '▾'}
        </button>
      </div>
      {open && (
        <div className="hud-dropdown">
          {projects.map((p) => (
            <button
              key={p.slug}
              className="hud-item"
              onClick={() => {
                useStore.getState().openTimeline(p.slug, p.name);
                setOpen(false);
              }}
            >
              <span className={p.isLive ? 'live-dot' : 'dead-dot'} />
              {p.name}
              <span className="dim"> · {p.sessionCount} sessions</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
