import { useEffect, useState } from 'react';
import type { RemoteProfile, RemoteState } from '../../../shared/ipc';

const STATUS_COLOR: Record<string, string> = {
  connected: '#8fbf7a',
  connecting: '#c79a4e',
  error: '#b85c5c',
  disconnected: '#6e7681',
};

const BLANK: RemoteProfile = {
  id: '',
  label: '',
  host: '',
  user: '',
  port: undefined,
  identityFile: '',
};

/** 远程 SSH 监控配置（学 clawd）：反向隧道把远程 hook 事件转回本地，远程 session 上沙滩 */
export function RemotesModal({ onClose }: { onClose: () => void }) {
  const [profiles, setProfiles] = useState<RemoteProfile[]>([]);
  const [states, setStates] = useState<Record<string, RemoteState>>({});
  const [form, setForm] = useState<RemoteProfile>(BLANK);
  const [busy, setBusy] = useState<string>('');
  const [deployMsg, setDeployMsg] = useState<Record<string, string>>({});

  async function refresh() {
    const r = await window.crabwatch.remoteList();
    setProfiles(r.profiles);
    setStates(Object.fromEntries(r.states.map((s) => [s.profileId, s])));
  }

  useEffect(() => {
    void refresh();
    return window.crabwatch.onEngineEvent((msg) => {
      if (msg.type === 'remote:state')
        setStates((prev) => ({ ...prev, [msg.state.profileId]: msg.state }));
    });
  }, []);

  async function add() {
    if (!form.host || !form.user || !form.label) return;
    await window.crabwatch.remoteUpsert({
      ...form,
      id: `r${Date.now()}`,
      identityFile: form.identityFile || undefined,
      port: form.port || undefined,
    });
    setForm(BLANK);
    await refresh();
  }

  async function deploy(id: string) {
    setBusy(id + ':deploy');
    try {
      const msg = await window.crabwatch.remoteDeploy(id);
      setDeployMsg((p) => ({ ...p, [id]: msg }));
    } catch (e) {
      setDeployMsg((p) => ({ ...p, [id]: `✗ ${String(e).slice(0, 80)}` }));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal remotes-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <span>remote machines</span>
          <button onClick={onClose}>×</button>
        </header>
        <div className="remotes-body">
          <div className="dim remotes-hint">
            Reverse SSH tunnel forwards a remote machine's hook events back here,
            so its sessions appear on the beach. Needs key-based SSH + node on
            the remote. First time: add → deploy hooks → connect.
          </div>
          {profiles.map((p) => {
            const st = states[p.id]?.status ?? 'disconnected';
            return (
              <div key={p.id} className="remote-row">
                <div className="remote-head">
                  <span
                    className="remote-dot"
                    style={{ background: STATUS_COLOR[st] }}
                  />
                  <b>{p.label}</b>{' '}
                  <span className="dim">
                    {p.user}@{p.host}
                    {p.port ? `:${p.port}` : ''}
                  </span>
                  <span className="remote-status" style={{ color: STATUS_COLOR[st] }}>
                    {st}
                  </span>
                </div>
                {states[p.id]?.message && (
                  <div className="remote-msg">{states[p.id].message}</div>
                )}
                {deployMsg[p.id] && (
                  <div className="remote-msg">{deployMsg[p.id]}</div>
                )}
                <div className="remote-actions">
                  {st === 'connected' || st === 'connecting' ? (
                    <button
                      onClick={() => void window.crabwatch.remoteDisconnect(p.id)}
                    >
                      disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => void window.crabwatch.remoteConnect(p.id)}
                    >
                      connect
                    </button>
                  )}
                  <button
                    disabled={busy === p.id + ':deploy'}
                    onClick={() => void deploy(p.id)}
                  >
                    {busy === p.id + ':deploy' ? 'deploying…' : 'deploy hooks'}
                  </button>
                  <button
                    className="remote-del"
                    onClick={() =>
                      void window.crabwatch.remoteRemove(p.id).then(refresh)
                    }
                  >
                    remove
                  </button>
                </div>
              </div>
            );
          })}
          <div className="remote-form">
            <div className="remotes-section dim">add machine</div>
            <input
              placeholder="label (e.g. mini)"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
            <div className="remote-form-row">
              <input
                placeholder="user"
                value={form.user}
                onChange={(e) => setForm({ ...form, user: e.target.value })}
              />
              <input
                placeholder="host"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
              />
              <input
                className="remote-port"
                placeholder="port"
                value={form.port ?? ''}
                onChange={(e) =>
                  setForm({ ...form, port: Number(e.target.value) || undefined })
                }
              />
            </div>
            <input
              placeholder="identity file (optional, e.g. ~/.ssh/id_ed25519)"
              value={form.identityFile ?? ''}
              onChange={(e) => setForm({ ...form, identityFile: e.target.value })}
            />
            <button className="remote-add" onClick={() => void add()}>
              add machine
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
