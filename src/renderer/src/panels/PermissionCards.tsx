import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { JsonView, Questions } from './JsonView';
import { Md } from './SessionPanel';
import type { PendingPerm } from '../state/store';

/** server 侧 50s 自动回「无意见」，卡片倒计时与之对齐 */
const TTL_MS = 50_000;

/** 按工具类型排版 tool_input：选项列表 / 计划 / 命令块 / 文件路径 / JSON 树兜底 */
function Body({ p }: { p: PendingPerm }) {
  const cmd = typeof p.input.command === 'string' ? p.input.command : undefined;
  const desc =
    typeof p.input.description === 'string' ? p.input.description : undefined;
  const filePath =
    typeof p.input.file_path === 'string' ? p.input.file_path : undefined;

  if (p.toolName === 'AskUserQuestion' && Array.isArray(p.input.questions))
    return (
      <div className="perm-brief">
        <Questions qs={p.input.questions} />
        <div className="dim perm-note">answer in terminal after allow</div>
      </div>
    );
  if (p.toolName === 'ExitPlanMode' && typeof p.input.plan === 'string')
    return (
      <div className="perm-brief">
        <div className="perm-plan">
          <Md text={p.input.plan} />
        </div>
      </div>
    );
  if (cmd)
    return (
      <div className="perm-brief">
        {desc && <div className="perm-desc">{desc}</div>}
        <pre className="perm-cmd">{cmd}</pre>
      </div>
    );
  if (filePath)
    return (
      <div className="perm-brief">
        <div className="mono perm-kv">{filePath}</div>
      </div>
    );
  if (Object.keys(p.input).length === 0)
    return (
      <div className="perm-brief">
        <div className="mono perm-kv">{p.brief}</div>
      </div>
    );
  return (
    <div className="perm-brief">
      <JsonView value={p.input} />
    </div>
  );
}

/** 权限请求卡（右下角堆叠）：直接 allow/deny，不用回终端 */
export function PermissionCards() {
  const perms = useStore((s) => s.pendingPerms);
  const crabs = useStore((s) => s.crabs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (perms.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [perms.length > 0]);

  if (perms.length === 0) return null;

  async function respond(id: string, behavior: 'allow' | 'deny') {
    await window.crabwatch.respondPermission(id, behavior);
    useStore.getState().removePerm(id);
  }

  return (
    <div className="perm-stack">
      {perms.map((p) => {
        const leftMs = Math.max(0, TTL_MS - (now - p.at));
        return (
          <div key={p.id} className="perm-card">
            <div className="perm-head">
              <span>
                {p.sessionId
                  ? (crabs[p.sessionId]?.projectName ?? 'session')
                  : 'session'}{' '}
                ▪ <b>{p.toolName}</b>
              </span>
              <span className="dim">{Math.ceil(leftMs / 1000)}s</span>
            </div>
            <Body p={p} />
            <div className="perm-timer">
              <div style={{ width: `${(leftMs / TTL_MS) * 100}%` }} />
            </div>
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
        );
      })}
    </div>
  );
}
