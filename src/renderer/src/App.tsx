import { useEffect } from 'react';
import { CanvasMap } from './map/CanvasMap';
import { SessionPanel } from './panels/SessionPanel';
import { AuditTimeline } from './panels/AuditTimeline';
import { CrabRoster } from './panels/CrabRoster';
import { Hud } from './panels/Hud';
import { useStore } from './state/store';

export function App() {
  const degraded = useStore((s) => s.degraded);

  useEffect(() => {
    void window.crabwatch.init().then((s) => useStore.getState().init(s));
    const off = window.crabwatch.onEngineEvent((msg) =>
      useStore.getState().apply(msg),
    );
    return off;
  }, []);

  return (
    <div className="app">
      {degraded && <div className="warning-bar">⚠ {degraded}</div>}
      <div className="map-wrap">
        <CanvasMap />
      </div>
      <Hud />
      <CrabRoster />
      <AuditTimeline />
      <SessionPanel />
    </div>
  );
}
