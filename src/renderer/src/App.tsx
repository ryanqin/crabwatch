import { useEffect } from 'react';
import { CanvasMap } from './map/CanvasMap';
import { SessionPanel } from './panels/SessionPanel';
import { AuditTimeline } from './panels/AuditTimeline';
import { CrabRoster } from './panels/CrabRoster';
import { PermissionCards } from './panels/PermissionCards';
import { Hud } from './panels/Hud';
import { useStore } from './state/store';

export function App() {
  const degraded = useStore((s) => s.degraded);

  useEffect(() => {
    void window.crabwatch.init().then((s) => useStore.getState().init(s));
    // 权限卡偏好（默认关）启动时同步给 main
    void window.crabwatch.setPermissionCards(
      localStorage.getItem('cw-perm-cards') === '1',
    );
    // 问答气泡偏好（默认开，无害）同步给 main
    void window.crabwatch.setQuestionBubble(
      localStorage.getItem('cw-question-bubble') !== '0',
    );
    const off = window.crabwatch.onEngineEvent((msg) =>
      useStore.getState().apply(msg),
    );
    // 略缩悬浮窗点行 → 主窗选中该 session
    const offFocus = window.crabwatch.onFocusSession((id) =>
      useStore.getState().select(id),
    );
    return () => {
      off();
      offFocus();
    };
  }, []);

  return (
    <div className="app">
      {degraded && <div className="warning-bar">⚠ {degraded}</div>}
      <div className="app-main">
        <AuditTimeline />
        <div className="map-wrap">
          <CanvasMap />
          <Hud />
          <CrabRoster />
          <PermissionCards />
        </div>
        <SessionPanel />
      </div>
    </div>
  );
}
