import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { JsonView } from './JsonView';
import { Md } from './SessionPanel';
import type { PendingPerm } from '../state/store';

/** server 侧 50s 自动回「无意见」，卡片倒计时与之对齐 */
const TTL_MS = 50_000;

interface QuestionSpec {
  question?: string;
  multiSelect?: boolean;
  options?: { label?: string; description?: string }[];
}

/**
 * AskUserQuestion 的可作答表单：选项点选 + 自由输入，提交 = allow + updatedInput
 * 预填 answers（Claude Code 跳过终端询问，机制学 clawd-on-desk）；
 * to terminal = deny，CC 回落终端原生问答。
 */
function QuestionForm({ p, onDone }: { p: PendingPerm; onDone: () => void }) {
  const qs = (
    Array.isArray(p.input.questions) ? p.input.questions : []
  ) as QuestionSpec[];
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  function pick(q: string, label: string, multi: boolean) {
    setAnswers((prev) => {
      const cur = prev[q] ?? [];
      if (multi)
        return {
          ...prev,
          [q]: cur.includes(label)
            ? cur.filter((l) => l !== label)
            : [...cur, label],
        };
      return { ...prev, [q]: [label] };
    });
  }

  const allAnswered = qs.every((q) => {
    const key = q.question ?? '';
    return (
      (answers[key]?.length ?? 0) > 0 || (other[key]?.trim().length ?? 0) > 0
    );
  });

  async function submit() {
    const ans: Record<string, string> = {};
    for (const q of qs) {
      const key = q.question ?? '';
      const free = other[key]?.trim();
      ans[key] = free || (answers[key] ?? []).join(', ');
    }
    await window.crabwatch.respondPermission(p.id, 'allow', {
      ...p.input,
      answers: ans,
    });
    onDone();
  }

  async function toTerminal() {
    await window.crabwatch.respondPermission(p.id, 'deny');
    onDone();
    if (p.sessionId) void window.crabwatch.focusTerminal(p.sessionId);
  }

  return (
    <div className="perm-brief">
      {qs.map((q, i) => {
        const key = q.question ?? '';
        return (
          <div key={i}>
            <div className="perm-q-text">{q.question}</div>
            {(q.options ?? []).map((o, j) => {
              const sel = (answers[key] ?? []).includes(o.label ?? '');
              return (
                <button
                  key={j}
                  className={`perm-opt perm-opt-btn ${sel ? 'sel' : ''}`}
                  onClick={() => pick(key, o.label ?? '', !!q.multiSelect)}
                >
                  {sel ? '●' : '○'} <b>{o.label}</b>
                  {o.description && (
                    <span className="dim"> — {o.description}</span>
                  )}
                </button>
              );
            })}
            <input
              className="perm-other"
              placeholder="other…"
              value={other[key] ?? ''}
              onChange={(e) => setOther({ ...other, [key]: e.target.value })}
            />
          </div>
        );
      })}
      <div className="perm-actions">
        <button
          className="perm-allow"
          disabled={!allAnswered}
          onClick={() => void submit()}
        >
          submit answer
        </button>
        <button className="perm-deny" onClick={() => void toTerminal()}>
          to terminal
        </button>
      </div>
    </div>
  );
}

/** 按工具类型排版 tool_input：计划 / 命令块 / 文件路径 / JSON 树兜底 */
function Body({ p }: { p: PendingPerm }) {
  const cmd = typeof p.input.command === 'string' ? p.input.command : undefined;
  const desc =
    typeof p.input.description === 'string' ? p.input.description : undefined;
  const filePath =
    typeof p.input.file_path === 'string' ? p.input.file_path : undefined;

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
        const isQuestion =
          p.toolName === 'AskUserQuestion' && Array.isArray(p.input.questions);
        return (
          <div key={p.id} className="perm-card">
            <div className="perm-head">
              <span>
                {p.sessionId
                  ? (crabs[p.sessionId]?.projectName ?? 'session')
                  : 'session'}{' '}
                ▪ <b>{isQuestion ? 'question' : p.toolName}</b>
              </span>
              <span className="dim">{Math.ceil(leftMs / 1000)}s</span>
            </div>
            {isQuestion ? (
              <>
                <QuestionForm
                  p={p}
                  onDone={() => useStore.getState().removePerm(p.id)}
                />
                <div className="perm-timer">
                  <div style={{ width: `${(leftMs / TTL_MS) * 100}%` }} />
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
