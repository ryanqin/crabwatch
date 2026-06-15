import { useState } from 'react';
import { useStore } from '../state/store';
import type { PendingPrompt } from '../../../shared/types';

/**
 * 行内提示：把 clawd 式的权限/计划/问答气泡就地展开在 roster 对应 session 行下。
 * 复用与独立气泡相同的 respondPermission 协议；作答即从 store 移除（main 也会回 prompt:close 兜底）。
 *   - permission：工具 + 命令/入参块 + always-allow 建议 + allow/deny/terminal
 *   - plan：计划正文 + approve/keep planning/terminal
 *   - question：选项(单/多选) + other 自由输入 + submit/terminal
 * terminal = 无意见({})，Claude Code 优雅回落终端。
 */

interface QOption {
  label?: string;
  description?: string;
}
interface QSpec {
  question?: string;
  multiSelect?: boolean;
  options?: QOption[];
}

function sugLabel(s: unknown): string {
  try {
    const o = s as {
      type?: string;
      rules?: { toolName?: string; ruleContent?: string }[];
      mode?: string;
    };
    if (o?.type === 'addRules' && o.rules?.[0]) {
      const r = o.rules[0];
      return `always allow ${r.toolName ?? ''}${r.ruleContent ? ' ' + r.ruleContent : ''}`;
    }
    if (o?.type === 'setMode') return `switch to ${o.mode} mode`;
  } catch {
    /* ignore */
  }
  return 'always allow';
}

export function PromptInline({ prompt }: { prompt: PendingPrompt }) {
  const { permId, sessionId, kind, toolName, toolInput, suggestions } = prompt;

  const resolve = (
    behavior?: 'allow' | 'deny',
    extra?: Record<string, unknown>,
  ) => {
    void window.crabwatch.respondPermission(permId, behavior, extra);
    useStore.getState().resolvePrompt(permId);
  };
  const toTerminal = () => {
    resolve(undefined); // 无意见 → 回落终端
    if (sessionId) void window.crabwatch.focusTerminal(sessionId);
  };

  return (
    <div className="pi">
      {kind === 'question' ? (
        <QuestionForm prompt={prompt} resolve={resolve} toTerminal={toTerminal} />
      ) : kind === 'plan' ? (
        <>
          <div className="pi-head">
            {toolName === 'ExitPlanMode' ? 'plan review' : toolName}
          </div>
          <pre className="pi-block pi-plan">
            {typeof toolInput.plan === 'string'
              ? toolInput.plan
              : JSON.stringify(toolInput, null, 2)}
          </pre>
          <div className="pi-actions">
            <button className="pi-btn pi-allow" onClick={() => resolve('allow')}>
              approve
            </button>
            <button className="pi-btn pi-deny" onClick={() => resolve('deny')}>
              keep planning
            </button>
            <button className="pi-btn pi-term" onClick={toTerminal}>
              terminal
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="pi-head">{toolName}</div>
          {typeof toolInput.description === 'string' && (
            <div className="pi-desc">{toolInput.description}</div>
          )}
          <pre className="pi-block">
            {typeof toolInput.command === 'string'
              ? toolInput.command
              : typeof toolInput.file_path === 'string'
                ? toolInput.file_path
                : Object.keys(toolInput).length
                  ? JSON.stringify(toolInput, null, 1)
                  : '(no input)'}
          </pre>
          {suggestions.map((s, i) => (
            <button
              key={i}
              className="pi-sug"
              onClick={() => resolve('allow', { updatedPermissions: [s] })}
            >
              {sugLabel(s)}
            </button>
          ))}
          <div className="pi-actions">
            <button className="pi-btn pi-allow" onClick={() => resolve('allow')}>
              allow
            </button>
            <button className="pi-btn pi-deny" onClick={() => resolve('deny')}>
              deny
            </button>
            <button className="pi-btn pi-term" onClick={toTerminal}>
              terminal
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function QuestionForm({
  prompt,
  resolve,
  toTerminal,
}: {
  prompt: PendingPrompt;
  resolve: (b?: 'allow' | 'deny', e?: Record<string, unknown>) => void;
  toTerminal: () => void;
}) {
  const qs: QSpec[] = Array.isArray(prompt.toolInput.questions)
    ? (prompt.toolInput.questions as QSpec[])
    : [];
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  const toggle = (q: QSpec, label: string) => {
    const k = q.question ?? '';
    setSel((prev) => {
      if (q.multiSelect) {
        const cur = prev[k] ? [...prev[k]] : [];
        const i = cur.indexOf(label);
        if (i >= 0) cur.splice(i, 1);
        else cur.push(label);
        return { ...prev, [k]: cur };
      }
      return { ...prev, [k]: [label] };
    });
  };

  const answered = qs.every((q) => {
    const k = q.question ?? '';
    return (sel[k] && sel[k].length) || other[k]?.trim();
  });

  const submit = () => {
    const answers: Record<string, string> = {};
    for (const q of qs) {
      const k = q.question ?? '';
      answers[k] = other[k]?.trim() ? other[k].trim() : (sel[k] ?? []).join(', ');
    }
    resolve('allow', { updatedInput: { ...prompt.toolInput, answers } });
  };

  return (
    <>
      <div className="pi-head">{prompt.sessionName} · question</div>
      {qs.map((q, qi) => {
        const k = q.question ?? '';
        return (
          <div key={qi} className="pi-qblock">
            <div className="pi-q">{q.question}</div>
            {(q.options ?? []).map((o, oi) => (
              <button
                key={oi}
                className={`pi-opt${(sel[k] ?? []).includes(o.label ?? '') ? ' sel' : ''}`}
                onClick={() => toggle(q, o.label ?? '')}
              >
                <b>{o.label}</b>
                {o.description && <span className="dim"> — {o.description}</span>}
              </button>
            ))}
            <input
              className="pi-other"
              placeholder="other…"
              value={other[k] ?? ''}
              onChange={(e) =>
                setOther((prev) => ({ ...prev, [k]: e.target.value }))
              }
            />
          </div>
        );
      })}
      <div className="pi-actions">
        <button className="pi-btn pi-allow" disabled={!answered} onClick={submit}>
          submit
        </button>
        <button className="pi-btn pi-term" onClick={toTerminal}>
          terminal
        </button>
      </div>
    </>
  );
}
