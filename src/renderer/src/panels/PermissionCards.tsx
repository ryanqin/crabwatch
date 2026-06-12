import { useStore } from '../state/store';

/** 权限请求卡（右下角堆叠）：直接 allow/deny，不用回终端 */
export function PermissionCards() {
  const perms = useStore((s) => s.pendingPerms);
  const crabs = useStore((s) => s.crabs);
  if (perms.length === 0) return null;

  async function respond(id: string, behavior: 'allow' | 'deny') {
    await window.crabwatch.respondPermission(id, behavior);
    useStore.getState().removePerm(id);
  }

  return (
    <div className="perm-stack">
      {perms.map((p) => (
        <div key={p.id} className="perm-card">
          <div className="perm-head">
            {p.sessionId ? (crabs[p.sessionId]?.projectName ?? 'session') : 'session'}{' '}
            ▪ <b>{p.toolName}</b>
          </div>
          <div className="perm-brief mono">{p.brief}</div>
          <div className="perm-actions">
            <button
              className="perm-allow"
              onClick={() => void respond(p.id, 'allow')}
            >
              allow
            </button>
            <button
              className="perm-deny"
              onClick={() => void respond(p.id, 'deny')}
            >
              deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
