import { useEffect, useRef, useState } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useStore } from '../state/store';
import { useDragWidth } from './useDragWidth';
import { JsonView, Questions } from './JsonView';
import type { ParsedLine } from '../../../shared/types';

const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g;

/** 统一的 markdown 渲染（消息/审计段落/解释共用）。
 *  传 onWikiLink 时额外把 [[wikilink]] 渲成可点（vault 浏览器用），其它调用方行为不变。 */
export function Md({
  text,
  onWikiLink,
}: {
  text: string;
  onWikiLink?: (target: string) => void;
}) {
  // 仅 vault 浏览器开启：[[target|显示]] → 带自定义 scheme 的链接，再在 a 组件里拦成 span
  const src = onWikiLink
    ? text.replace(WIKILINK_RE, (_m, inner: string) => {
        const pipe = inner.indexOf('|');
        const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
        const display = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim();
        return `[${display}](wikilink:${encodeURIComponent(target)})`;
      })
    : text;
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        urlTransform={
          onWikiLink
            ? (url) =>
                url.startsWith('wikilink:') ? url : defaultUrlTransform(url)
            : undefined
        }
        components={
          onWikiLink
            ? {
                a({ href, children, node: _node, ...rest }) {
                  if (href && href.startsWith('wikilink:')) {
                    const target = decodeURIComponent(
                      href.slice('wikilink:'.length),
                    );
                    return (
                      <span
                        className="wikilink"
                        title={target}
                        onClick={() => onWikiLink(target)}
                      >
                        {children}
                      </span>
                    );
                  }
                  return (
                    <a href={href} {...rest}>
                      {children}
                    </a>
                  );
                },
              }
            : undefined
        }
      >
        {src}
      </Markdown>
    </div>
  );
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h${m % 60}m ago`;
}

function toolBrief(input: unknown): string {
  if (input && typeof input === 'object') {
    const i = input as Record<string, unknown>;
    if (typeof i.file_path === 'string')
      return i.file_path.split('/').pop() ?? '';
    if (typeof i.command === 'string') return i.command.slice(0, 50);
    if (typeof i.description === 'string') return i.description.slice(0, 40);
  }
  return '';
}

/** 工具调用行：点击展开完整入参（AskUserQuestion 渲染成选项列表，其余 JSON 树） */
function ToolUse({ tu }: { tu: { id: string; name: string; input: unknown } }) {
  const [open, setOpen] = useState(false);
  const input = (tu.input ?? {}) as Record<string, unknown>;
  return (
    <>
      <button className="msg tool tool-toggle" onClick={() => setOpen(!open)}>
        🔧 {tu.name} <span className="dim">{toolBrief(tu.input)}</span>
      </button>
      {open && (
        <div className="msg tool-detail">
          {tu.name === 'AskUserQuestion' && Array.isArray(input.questions) ? (
            <Questions qs={input.questions} />
          ) : tu.name === 'ExitPlanMode' && typeof input.plan === 'string' ? (
            <Md text={input.plan} />
          ) : (
            <JsonView value={input} />
          )}
        </div>
      )}
    </>
  );
}

type Speaker = 'you' | 'claude';

/** 一行属于谁说的（用来在说话人切换时打一个轻角色标识）。
 *  空的 assistant 行（无文本无工具）不算 claude，避免孤立标签。 */
function speakerOf(pl: ParsedLine): Speaker | null {
  const { line } = pl;
  if (line.kind === 'user' && !line.isMeta && line.text) return 'you';
  if (line.kind === 'assistant' && (line.text || line.toolUses.length))
    return 'claude';
  return null;
}

export function Line({
  pl,
  role = null,
}: {
  pl: ParsedLine;
  role?: Speaker | null;
}) {
  const { line } = pl;
  // 说话人切换时才出标签（连续同一人不重复），一眼可辨谁在说
  const label = role ? <div className={`role-label ${role}`}>{role}</div> : null;
  if (line.kind === 'user' && !line.isMeta && line.text)
    return (
      <>
        {label}
        <div className="msg user">
          <Md text={line.text.slice(0, 1500)} />
        </div>
      </>
    );
  if (line.kind === 'assistant') {
    return (
      <>
        {label}
        {line.toolUses.map((tu) => (
          <ToolUse key={tu.id} tu={tu} />
        ))}
        {line.text && (
          <div className="msg bot">
            <Md text={line.text.slice(0, 2500)} />
          </div>
        )}
      </>
    );
  }
  if (line.kind === 'system' && line.subtype === 'turn_duration')
    return (
      <div className="msg turn">
        ⏱ {line.durationMs ? (line.durationMs / 1000).toFixed(1) + 's' : 'turn'}
      </div>
    );
  return null;
}

function reasonMsg(r: { reason?: string; app?: string }): string {
  switch (r.reason) {
    case 'no-terminal':
      return "couldn't find this session's terminal";
    case 'imprecise':
      return `found ${r.app ?? 'the app'} but not its exact tab — focus that session, then resend`;
    case 'accessibility':
      return 'grant CrabWatch Accessibility (System Settings ▸ Privacy ▸ Accessibility), then resend';
    case 'front-mismatch':
      return `${r.app ?? 'another app'} was in front — nothing sent`;
    default:
      return 'send failed';
  }
}

/** 发送按钮的小图标：圆头纸飞机 */
function SendIcon() {
  return (
    <svg className="send-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.3 20.4l17.6-7.55a1 1 0 0 0 0-1.84L3.3 3.46a.5.5 0 0 0-.7.62L4.9 11 14 12l-9.1 1-2.3 6.78a.5.5 0 0 0 .7.62z" />
    </svg>
  );
}

/** 给选中的 session 发消息：聚焦其终端 → 剪贴板粘贴 → 回车，全程前台校验护栏 */
function Composer({ sessionId, remote }: { sessionId: string; remote?: string }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  if (remote)
    return (
      <div className="composer-remote dim">remote session ▪ type on its own machine</div>
    );

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setStatus(null);
    try {
      const r = await window.crabwatch.sendToSession(sessionId, text, true);
      if (r.ok) {
        setText('');
        setStatus({ ok: true, msg: 'sent ✓' });
        setTimeout(() => setStatus(null), 2500);
      } else {
        setStatus({ ok: false, msg: reasonMsg(r) });
      }
    } catch {
      setStatus({ ok: false, msg: 'send failed' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        placeholder="message this session…  (↵ send · ⇧↵ newline)"
        value={text}
        rows={2}
        disabled={sending}
        onChange={(e) => {
          setText(e.target.value);
          if (status && !status.ok) setStatus(null);
        }}
        onKeyDown={(e) => {
          // IME 合成期（打中文）的 Enter 是上屏确认，绝不能当发送
          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            !(e.nativeEvent as { isComposing?: boolean }).isComposing
          ) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="composer-row">
        <button
          className="linklike"
          onClick={() => void window.crabwatch.focusTerminal(sessionId)}
        >
          terminal →
        </button>
        <button
          className="send-btn"
          title="send ↵"
          disabled={!text.trim() || sending}
          onClick={() => void send()}
        >
          {sending ? <span className="send-sending">…</span> : <SendIcon />}
        </button>
      </div>
      {status && (
        <div className={status.ok ? 'composer-ok' : 'composer-err'}>
          {status.msg}
        </div>
      )}
    </div>
  );
}

export function SessionPanel() {
  const selectedId = useStore((s) => s.selectedId);
  const crab = useStore((s) => (s.selectedId ? s.crabs[s.selectedId] : undefined));
  const recent = useStore((s) => s.recent);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, onDragStart] = useDragWidth('cw-session-width', 400, 'left');

  useEffect(() => {
    if (!selectedId) return;
    void window.crabwatch.getRecent(selectedId, 60).then((lines) => {
      // 面板打开期间 transcript:lines 会继续 append，这里只做初始填充
      useStore.getState().setRecent(lines);
    });
  }, [selectedId]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [recent]);

  if (!selectedId || !crab) return null;
  return (
    <aside className="session-panel" style={{ width }}>
      <div className="drag-handle handle-left" onMouseDown={onDragStart} />
      <header>
        <div>
          <div className="panel-project">
            {crab.projectName}
            <span className="dim"> ▪ {crab.sessionId.slice(0, 8)}</span>
            {crab.remoteSource && (
              <span className="remote-tag"> ▪ via {crab.remoteSource}</span>
            )}
          </div>
          {crab.title && <div className="panel-title">{crab.title}</div>}
          <div className="panel-state">
            {crab.state} ▪ {ago(crab.lastActivity)}
          </div>
          {crab.projectPath && (
            <div className="panel-path dim">{crab.projectPath}</div>
          )}
        </div>
        <button onClick={() => useStore.getState().select(undefined)}>×</button>
      </header>
      <div className="panel-body" ref={bodyRef}>
        {recent.length === 0 && <div className="dim">(no messages yet)</div>}
        {(() => {
          let last: Speaker | null = null;
          return recent.map((pl, i) => {
            const sp = speakerOf(pl);
            const showRole = sp !== null && sp !== last;
            if (sp !== null) last = sp;
            return (
              <Line key={`${pl.byteStart}-${i}`} pl={pl} role={showRole ? sp : null} />
            );
          });
        })()}
      </div>
      <div className="panel-footer">
        <Composer sessionId={selectedId} remote={crab.remoteSource} />
      </div>
    </aside>
  );
}
