import { useState } from 'react';
import { useStore } from '../state/store';
import { UsageBadge } from './UsageBadge';
import { AnimationsModal } from './AnimationsModal';
import { playSound, soundsEnabled } from '../sound';
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
  const [sounds, setSounds] = useState(() => soundsEnabled());
  const [questionBubble, setQuestionBubble] = useState(
    () => localStorage.getItem('cw-question-bubble') !== '0',
  );
  const [popups, setPopups] = useState(
    () => localStorage.getItem('cw-popups') === '1',
  );
  const [showAnims, setShowAnims] = useState(false);

  function togglePermCards(on: boolean) {
    setPermCards(on);
    localStorage.setItem('cw-perm-cards', on ? '1' : '0');
    void window.crabwatch.setPermissionCards(on);
  }

  function toggleQuestionBubble(on: boolean) {
    setQuestionBubble(on);
    localStorage.setItem('cw-question-bubble', on ? '1' : '0');
    void window.crabwatch.setQuestionBubble(on);
  }

  function toggleSounds(on: boolean) {
    setSounds(on);
    localStorage.setItem('cw-sounds', on ? '1' : '0');
    if (on) playSound('complete', true); // 勾上立刻试听
  }

  function togglePopups(on: boolean) {
    setPopups(on);
    localStorage.setItem('cw-popups', on ? '1' : '0');
    if (on) void window.crabwatch.showPopup('crabwatch', 'popups enabled'); // 勾上立刻预览
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
              checked={questionBubble}
              onChange={(e) => toggleQuestionBubble(e.target.checked)}
            />{' '}
            question bubble
            <span className="dim"> (answer on desktop)</span>
          </label>
          <label className="hud-item hud-toggle">
            <input
              type="checkbox"
              checked={permCards}
              onChange={(e) => togglePermCards(e.target.checked)}
            />{' '}
            permission bubble
            <span className="dim"> (allow/deny on desktop)</span>
          </label>
          <label className="hud-item hud-toggle">
            <input
              type="checkbox"
              checked={sounds}
              onChange={(e) => toggleSounds(e.target.checked)}
            />{' '}
            sounds
            <span className="dim"> (waiting / permission)</span>
          </label>
          <label className="hud-item hud-toggle">
            <input
              type="checkbox"
              checked={popups}
              onChange={(e) => togglePopups(e.target.checked)}
            />{' '}
            popups
            <span className="dim"> (screen corner)</span>
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
          <button
            className="hud-item"
            onClick={() => {
              setShowAnims(true);
              setOpenSettings(false);
              useStore.getState().setHudMenuOpen(false);
            }}
          >
            animations…
          </button>
        </div>
      )}
      {showAnims && <AnimationsModal onClose={() => setShowAnims(false)} />}
    </div>
  );
}
