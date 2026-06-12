import { useState } from 'react';
import { useStore } from '../state/store';
import { UsageBadge } from './UsageBadge';
import type { ProjectListing } from '../../../shared/types';

export function Hud() {
  const [open, setOpen] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);
  const [projects, setProjects] = useState<ProjectListing[]>([]);
  const [autoLaunch, setAutoLaunch] = useState<{
    enabled: boolean;
    packaged: boolean;
  }>();
  const [permCards, setPermCards] = useState(
    () => localStorage.getItem('cw-perm-cards') === '1',
  );

  function togglePermCards(on: boolean) {
    setPermCards(on);
    localStorage.setItem('cw-perm-cards', on ? '1' : '0');
    void window.crabwatch.setPermissionCards(on);
  }

  async function toggle() {
    if (!open) setProjects(await window.crabwatch.listProjects());
    setOpen(!open);
    setOpenSettings(false);
    useStore.getState().setHudMenuOpen(!open);
  }

  async function toggleSettings() {
    if (!openSettings) setAutoLaunch(await window.crabwatch.getAutoLaunch());
    setOpenSettings(!openSettings);
    setOpen(false);
    useStore.getState().setHudMenuOpen(!openSettings);
  }

  return (
    <div className="hud">
      <div className="hud-row">
        <UsageBadge />
        <button className="hud-btn" onClick={() => void toggle()}>
          timeline {open ? '▴' : '▾'}
        </button>
        <button className="hud-btn" onClick={() => void toggleSettings()}>
          settings {openSettings ? '▴' : '▾'}
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
                useStore.getState().setHudMenuOpen(false);
              }}
            >
              <span className={p.isLive ? 'live-dot' : 'dead-dot'} />
              {p.name}
              <span className="dim"> · {p.sessionCount} sessions</span>
            </button>
          ))}
        </div>
      )}
      {openSettings && (
        <div className="hud-dropdown hud-settings">
          <label className="hud-item hud-toggle">
            <input
              type="checkbox"
              checked={permCards}
              onChange={(e) => togglePermCards(e.target.checked)}
            />{' '}
            permission cards
            <span className="dim"> (answer in-app)</span>
          </label>
          {autoLaunch && (
            <label className="hud-item hud-toggle">
              <input
                type="checkbox"
                checked={autoLaunch.enabled}
                onChange={(e) =>
                  void window.crabwatch
                    .setAutoLaunch(e.target.checked)
                    .then(setAutoLaunch)
                }
              />{' '}
              launch at login
              {!autoLaunch.packaged && (
                <span className="dim"> (packaged app only)</span>
              )}
            </label>
          )}
        </div>
      )}
    </div>
  );
}
