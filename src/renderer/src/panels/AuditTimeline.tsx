import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { Line } from './SessionPanel';
import { useDragWidth } from './useDragWidth';
import type {
  OrganizeResult,
  ParsedLine,
  ProjectTimelineEntry,
  Segment,
} from '../../../shared/types';

function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function SegRow({
  seg,
  transcriptPath,
  projectName,
  onRaw,
}: {
  seg: Segment;
  transcriptPath: string;
  projectName: string;
  onRaw: (seg: Segment, transcriptPath: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<string>();
  const [summarizing, setSummarizing] = useState(false);
  const [summaryErr, setSummaryErr] = useState(false);

  async function explain() {
    setSummarizing(true);
    setSummaryErr(false);
    try {
      setSummary(await window.crabwatch.summarize(seg, projectName));
    } catch {
      setSummaryErr(true);
    } finally {
      setSummarizing(false);
    }
  }
  const tests = seg.commands.filter((c) => c.kind === 'test');
  const chips: string[] = [];
  if (seg.filesEdited.length) chips.push(`✏️ ${seg.filesEdited.length}`);
  if (seg.commands.length)
    chips.push(
      `▶ ${seg.commands.length}${tests.length ? ` (test ${tests.every((t) => t.ok !== false) ? '✓' : '✗'})` : ''}`,
    );
  if (seg.commits.length) chips.push(`⎇ ${seg.commits.length}`);
  if (seg.subagents.length) chips.push(`🤖 ${seg.subagents.length}`);
  chips.push(`${fmtTok(seg.tokens.input + seg.tokens.output)} tok`);
  if (seg.durationMs) chips.push(`${(seg.durationMs / 60000).toFixed(1)}m`);

  return (
    <div className={`seg ${open ? 'open' : ''}`}>
      <button className="seg-head" onClick={() => setOpen(!open)}>
        <span className="seg-chips">{chips.join(' · ')}</span>
        <span className="seg-prompt">「{seg.promptPreview.slice(0, 70)}」</span>
      </button>
      {open && (
        <div className="seg-body">
          <div className="seg-section">
            <b>Prompt</b>
            <p>{seg.promptFull.slice(0, 600)}</p>
          </div>
          {seg.assistantGist && (
            <div className="seg-section">
              <b>Final reply</b>
              <p>{seg.assistantGist}</p>
            </div>
          )}
          {seg.filesEdited.length > 0 && (
            <div className="seg-section">
              <b>Files edited</b>
              {seg.filesEdited.map((f) => (
                <div key={f} className="mono">
                  {f.split('/').slice(-2).join('/')}
                </div>
              ))}
            </div>
          )}
          {seg.commands.length > 0 && (
            <div className="seg-section">
              <b>Commands</b>
              {seg.commands.map((c, i) => (
                <div key={i} className="mono">
                  {c.ok === false ? '✗' : c.ok ? '✓' : '·'} [{c.kind}]{' '}
                  {c.cmd.slice(0, 80)}
                </div>
              ))}
            </div>
          )}
          {seg.commits.length > 0 && (
            <div className="seg-section">
              <b>Commits</b>
              {seg.commits.map((c, i) => (
                <div key={i} className="mono">
                  ⎇ {c.message}
                </div>
              ))}
            </div>
          )}
          {seg.subagents.length > 0 && (
            <div className="seg-section">
              <b>Subagents</b>
              {seg.subagents.map((a, i) => (
                <div key={i} className="mono">
                  🤖 {a.agentType}: {a.description}
                </div>
              ))}
            </div>
          )}
          {summary && (
            <div className="seg-section seg-summary">
              <b>🪄 Explained</b>
              <p>{summary}</p>
            </div>
          )}
          <div className="seg-actions">
            {!summary && (
              <button onClick={() => void explain()} disabled={summarizing}>
                {summarizing ? 'Explaining…' : summaryErr ? 'Failed — retry' : '🪄 Explain'}
              </button>
            )}
            <button onClick={() => onRaw(seg, transcriptPath)}>
              Raw log (lines {seg.lineRange[0]}–{seg.lineRange[1]})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RawModal({
  title,
  text,
  lines,
  onClose,
}: {
  title: string;
  text: string;
  lines: ParsedLine[];
  onClose: () => void;
}) {
  const [showJson, setShowJson] = useState(false);
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <span>{title}</span>
          <span>
            <button
              className="toolbar-btn"
              onClick={() => setShowJson(!showJson)}
            >
              {showJson ? 'readable' : '{ } raw JSON'}
            </button>{' '}
            <button onClick={onClose}>×</button>
          </span>
        </header>
        {showJson || lines.length === 0 ? (
          <pre>{text}</pre>
        ) : (
          <div className="panel-body">
            {lines.map((pl, i) => (
              <Line key={i} pl={pl} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AuditTimeline() {
  const timeline = useStore((s) => s.timeline);
  const liveCrabs = useStore((s) => s.crabs);
  const [width, onDragStart] = useDragWidth('cw-timeline-width', 560, 'right');
  const [entries, setEntries] = useState<ProjectTimelineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState<{
    title: string;
    text: string;
    lines: ParsedLine[];
  }>();
  const [org, setOrg] = useState<OrganizeResult>();
  const [organizing, setOrganizing] = useState(false);
  const [progress, setProgress] = useState<string>('');
  /** false = 最新优先（默认） */
  const [sortAsc, setSortAsc] = useState(false);
  const [view, setView] = useState<'time' | 'task'>('time');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  function toggleTask(task: string) {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(task)) next.delete(task);
      else next.add(task);
      return next;
    });
  }

  useEffect(() => {
    if (!timeline) return;
    setLoading(true);
    setEntries([]);
    setOrg(undefined);
    // 串行：organize 内部也会 build timeline，并发会重复解析 + 缓存写竞争
    void window.crabwatch
      .getTimeline(timeline.slug)
      .then(async (es) => {
        setEntries(es);
        setLoading(false);
        const r = await window.crabwatch.organize(timeline.slug, true);
        setOrg(r);
        if (r.clusters.length > 0) setView('task');
      })
      .catch((err) => {
        setLoading(false);
        setRaw({
          title: 'Failed to load timeline',
          text: String(err),
          lines: [],
        });
      });
  }, [timeline?.slug]);

  useEffect(() => {
    return window.crabwatch.onEngineEvent((msg) => {
      if (msg.type === 'organize:progress')
        setProgress(`${msg.done}/${msg.total}`);
    });
  }, []);

  async function runOrganize() {
    if (!timeline) return;
    setOrganizing(true);
    setProgress('');
    try {
      const r = await window.crabwatch.organize(timeline.slug, false);
      setOrg(r);
    } finally {
      setOrganizing(false);
    }
  }

  if (!timeline) return null;

  async function showRaw(seg: Segment, transcriptPath: string) {
    try {
      const { text, lines } = await window.crabwatch.getRaw(
        transcriptPath,
        seg.byteRange[0],
        seg.byteRange[1],
      );
      setRaw({
        title: `Transcript · lines ${seg.lineRange[0]}–${seg.lineRange[1]}`,
        text,
        lines,
      });
    } catch (err) {
      setRaw({
        title: 'Failed to read transcript',
        text: String(err),
        lines: [],
      });
    }
  }

  function sessionCard(e: ProjectTimelineEntry, showRelay: boolean) {
    const tok = e.segments.reduce(
      (s, x) => s + x.tokens.input + x.tokens.output,
      0,
    );
    const title = org?.names[e.sessionId]?.title ?? e.title ?? '(untitled)';
    return (
      <div key={e.sessionId} className="session-card">
        <div className="session-card-head">
          {liveCrabs[e.sessionId] && <span className="live-dot" />}
          {showRelay && (
            <>
              <span className={e.relayFromPrev ? 'relay' : 'fresh'}>
                {e.relayFromPrev ? '│ relay' : '┌ new'}
              </span>{' '}
            </>
          )}
          <b>{e.firstTs?.slice(0, 10)}</b>{' '}
          <span className="dim">▪ {e.sessionId.slice(0, 8)}</span>
          <div className="session-card-title">
            {title}{' '}
            <span className="dim">
              ▪ {e.segments.length} segs ▪ {fmtTok(tok)} tok
            </span>
          </div>
        </div>
        {e.segments.map((seg) => (
          <SegRow
            key={seg.id}
            seg={seg}
            transcriptPath={e.transcriptPath}
            projectName={timeline!.name}
            onRaw={(s, p) => void showRaw(s, p)}
          />
        ))}
      </div>
    );
  }

  // 默认最新优先，可切正序
  const entriesDisplay = sortAsc ? entries : [...entries].reverse();
  const byId = new Map(entries.map((e) => [e.sessionId, e]));
  const clustered = new Set((org?.clusters ?? []).flatMap((c) => c.sessionIds));
  const unclustered = entriesDisplay.filter((e) => !clustered.has(e.sessionId));
  const lastOf = (c: { sessionIds: string[] }) =>
    c.sessionIds.reduce(
      (max, id) =>
        (byId.get(id)?.lastTs ?? '') > max ? byId.get(id)!.lastTs! : max,
      '',
    );
  const clustersDesc = [...(org?.clusters ?? [])].sort((a, b) =>
    lastOf(b).localeCompare(lastOf(a)),
  );

  return (
    <aside className="timeline-panel" style={{ width }}>
      <header>
        <div className="tl-titlebar">
          <span className="panel-project">{timeline.name}</span>
          <span className="dim tl-count">
            ▪ {loading ? 'parsing…' : `${entries.length} sessions`}
          </span>
          <button
            className="tl-close"
            onClick={() => useStore.getState().closeTimeline()}
          >
            ×
          </button>
        </div>
        <div className="timeline-toolbar">
          <button
            className={`toolbar-btn ${view === 'time' ? 'active' : ''}`}
            onClick={() =>
              view === 'time' ? setSortAsc(!sortAsc) : setView('time')
            }
          >
            time {sortAsc ? '↑' : '↓'}
          </button>
          <span className="tl-sep">▪</span>
          <button
            className={`toolbar-btn ${view === 'task' ? 'active' : ''}`}
            onClick={() => setView('task')}
            disabled={(org?.clusters.length ?? 0) === 0}
          >
            task
          </button>
          <span className="tl-sep">▪</span>
          <button
            className="toolbar-btn"
            onClick={() => void runOrganize()}
            disabled={organizing || loading}
          >
            {organizing ? `organizing… ${progress}` : 'sessions'}
          </button>
        </div>
      </header>
      <div className="timeline-body">
        {view === 'time' && entriesDisplay.map((e) => sessionCard(e, true))}
        {view === 'task' &&
          clustersDesc.map((c) => {
            const members = c.sessionIds
              .map((id) => byId.get(id))
              .filter((x): x is ProjectTimelineEntry => Boolean(x))
              .sort((a, b) => (b.firstTs ?? '').localeCompare(a.firstTs ?? ''));
            if (members.length === 0) return null;
            const open = expandedTasks.has(c.task);
            const hasLive = members.some((m) => liveCrabs[m.sessionId]);
            return (
              <div key={c.task} className="task-group">
                <button className="task-head" onClick={() => toggleTask(c.task)}>
                  {open ? '▾' : '▸'} {c.task}{' '}
                  {hasLive && <span className="live-dot" />}
                  <span className="dim">▪ {members.length} sessions</span>
                </button>
                {open && members.map((e) => sessionCard(e, false))}
              </div>
            );
          })}
        {view === 'task' && unclustered.length > 0 && (
          <div className="task-group">
            <button className="task-head" onClick={() => toggleTask('__new')}>
              {expandedTasks.has('__new') ? '▾' : '▸'} not yet grouped{' '}
              {unclustered.some((e) => liveCrabs[e.sessionId]) && (
                <span className="live-dot" />
              )}
              <span className="dim">▪ {unclustered.length} sessions</span>
            </button>
            {expandedTasks.has('__new') &&
              unclustered.map((e) => sessionCard(e, false))}
          </div>
        )}
      </div>
      <div className="drag-handle handle-right" onMouseDown={onDragStart} />
      {raw && (
        <RawModal
          title={raw.title}
          text={raw.text}
          lines={raw.lines}
          onClose={() => setRaw(undefined)}
        />
      )}
    </aside>
  );
}
