import { useState } from 'react';

/** 原始值：长字符串截断，点击展开全文 */
function Prim({ v }: { v: unknown }) {
  const [full, setFull] = useState(false);
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? 'undefined';
  if (s.length <= 100 || full) return <span className="jv-prim">{s}</span>;
  return (
    <button className="jv-prim jv-more" onClick={() => setFull(true)}>
      {s.slice(0, 100)}… <span className="dim">+{s.length - 100} chars</span>
    </button>
  );
}

function Row({ k, v, depth }: { k: string; v: unknown; depth: number }) {
  const expandable = v !== null && typeof v === 'object';
  const [open, setOpen] = useState(false);
  if (!expandable)
    return (
      <div className="jv-row" style={{ paddingLeft: depth * 10 }}>
        <span className="dim">{k}:</span> <Prim v={v} />
      </div>
    );
  const n = Array.isArray(v) ? v.length : Object.keys(v as object).length;
  return (
    <>
      <button
        className="jv-row jv-toggle"
        style={{ paddingLeft: depth * 10 }}
        onClick={() => setOpen(!open)}
      >
        {open ? '▾' : '▸'} <span className="dim">{k}</span>{' '}
        <span className="jv-meta">{Array.isArray(v) ? `[${n}]` : `{${n}}`}</span>
      </button>
      {open && <JsonView value={v} depth={depth + 1} />}
    </>
  );
}

/** 可交互 JSON 树：对象/数组点击展开收起，嵌套缩进 */
export function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || typeof value !== 'object') return <Prim v={value} />;
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="dim">(empty)</span>;
  return (
    <div className="jv">
      {entries.map(([k, v]) => (
        <Row key={k} k={k} v={v} depth={depth} />
      ))}
    </div>
  );
}

/** AskUserQuestion 的 questions 专项渲染：问题 + 选项列表 */
export function Questions({ qs }: { qs: unknown }) {
  if (!Array.isArray(qs)) return null;
  return (
    <div className="perm-questions">
      {qs.map((q, i) => {
        const qq = q as {
          question?: string;
          options?: { label?: string; description?: string }[];
        };
        return (
          <div key={i}>
            {qq.question && <div className="perm-q-text">{qq.question}</div>}
            {Array.isArray(qq.options) &&
              qq.options.map((o, j) => (
                <div key={j} className="perm-opt">
                  <b>{o.label}</b>
                  {o.description && (
                    <span className="dim"> — {o.description}</span>
                  )}
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
