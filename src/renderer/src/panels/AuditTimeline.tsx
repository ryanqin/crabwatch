import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import type {
  OrganizeResult,
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
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <span>{title}</span>
          <button onClick={onClose}>×</button>
        </header>
        <pre>{text}</pre>
      </div>
    </div>
  );
}

export function AuditTimeline() {
  const timeline = useStore((s) => s.timeline);
  const [entries, setEntries] = useState<ProjectTimelineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState<{ title: string; text: string }>();
  const [org, setOrg] = useState<OrganizeResult>();
  const [organizing, setOrganizing] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [view, setView] = useState<'time' | 'task'>('time');

  useEffect(() => {
    if (!timeline) return;
    setLoading(true);
    setEntries([]);
    setOrg(undefined);
    setView('time');
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
        setRaw({ title: 'Failed to load timeline', text: String(err) });
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
      if (r.clusters.length > 0) setView('task');
    } finally {
      setOrganizing(false);
    }
  }

  if (!timeline) return null;

  async function showRaw(seg: Segment, transcriptPath: string) {
    try {
      const text = await window.crabwatch.getRaw(
        transcriptPath,
        seg.byteRange[0],
        seg.byteRange[1],
      );
      setRaw({
        title: `Raw transcript · lines ${seg.lineRange[0]}–${seg.lineRange[1]}`,
        text,
      });
    } catch (err) {
      setRaw({ title: 'Failed to read raw transcript', text: String(err) });
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
          {showRelay && (
            <>
              <span className={e.relayFromPrev ? 'relay' : 'fresh'}>
                {e.relayFromPrev ? '│ relay' : '┌ new'}
              </span>{' '}
            </>
          )}
          <b>{e.firstTs?.slice(0, 10)}</b>{' '}
          <span className="dim">{e.sessionId.slice(0, 8)}</span>
          <div className="session-card-title">
            {title}{' '}
            <span className="dim">
              · {e.segments.length} segs · {fmtTok(tok)} tok
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

  const byId = new Map(entries.map((e) => [e.sessionId, e]));
  const clustered = new Set(
    (org?.clusters ?? []).flatMap((c) => c.sessionIds),
  );
  const unclustered = entries.filter((e) => !clustered.has(e.sessionId));

  return (
    <aside className="timeline-panel">
      <header>
        <div>
          <div className="panel-project">📋 {timeline.name} timeline</div>
          <div className="panel-state">
            {loading ? 'Parsing…' : `${entries.length} sessions`}
          </div>
        </div>
        <div className="timeline-toolbar">
          {(org?.clusters.length ?? 0) > 0 && (
            <button
              className="toolbar-btn"
              onClick={() => setView(view === 'task' ? 'time' : 'task')}
            >
              {view === 'task' ? '🕐 by time' : '🧩 by task'}
            </button>
          )}
          <button
            className="toolbar-btn"
            onClick={() => void runOrganize()}
            disabled={organizing || loading}
          >
            {organizing
              ? `Organizing… ${progress}`
              : '✨ Name & group sessions'}
          </button>
          <button onClick={() => useStore.getState().closeTimeline()}>×</button>
        </div>
      </header>
      <div className="timeline-body">
        {view === 'time' &&
          entries.map((e) => sessionCard(e, true))}
        {view === 'task' &&
          (org?.clusters ?? []).map((c) => {
            const members = c.sessionIds
              .map((id) => byId.get(id))
              .filter((x): x is ProjectTimelineEntry => Boolean(x));
            if (members.length === 0) return null;
            return (
              <div key={c.task} className="task-group">
                <div className="task-head">
                  🧩 {c.task}{' '}
                  <span className="dim">· {members.length} sessions</span>
                </div>
                {members.map((e) => sessionCard(e, false))}
              </div>
            );
          })}
        {view === 'task' && unclustered.length > 0 && (
          <div className="task-group">
            <div className="task-head">
              🆕 Not yet grouped{' '}
              <span className="dim">· {unclustered.length} sessions</span>
            </div>
            {unclustered.map((e) => sessionCard(e, false))}
          </div>
        )}
      </div>
      {raw && (
        <RawModal
          title={raw.title}
          text={raw.text}
          onClose={() => setRaw(undefined)}
        />
      )}
    </aside>
  );
}
