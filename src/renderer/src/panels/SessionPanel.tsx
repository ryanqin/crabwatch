import { useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../state/store';
import { useDragWidth } from './useDragWidth';
import type { ParsedLine } from '../../../shared/types';

/** 统一的 markdown 渲染（消息/审计段落/解释共用） */
export function Md({ text }: { text: string }) {
  return (
    <div className="md">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
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

export function Line({ pl }: { pl: ParsedLine }) {
  const { line } = pl;
  if (line.kind === 'user' && !line.isMeta && line.text)
    return (
      <div className="msg user">
        <Md text={line.text.slice(0, 1500)} />
      </div>
    );
  if (line.kind === 'assistant') {
    return (
      <>
        {line.toolUses.map((tu) => (
          <div key={tu.id} className="msg tool">
            🔧 {tu.name} <span className="dim">{toolBrief(tu.input)}</span>
          </div>
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
          </div>
          {crab.title && <div className="panel-title">{crab.title}</div>}
          <div className="panel-state">
            {crab.state} ▪ {ago(crab.lastActivity)}
          </div>
        </div>
        <button onClick={() => useStore.getState().select(undefined)}>×</button>
      </header>
      <div className="panel-body" ref={bodyRef}>
        {recent.length === 0 && <div className="dim">(no messages yet)</div>}
        {recent.map((pl, i) => (
          <Line key={`${pl.byteStart}-${i}`} pl={pl} />
        ))}
      </div>
      <div className="panel-footer">
        <button
          className="linklike"
          onClick={() => void window.crabwatch.focusTerminal(selectedId)}
        >
          terminal -&gt;
        </button>
      </div>
    </aside>
  );
}
