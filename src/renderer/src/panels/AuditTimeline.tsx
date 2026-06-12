import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import type { ProjectTimelineEntry, Segment } from '../../../shared/types';

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

  useEffect(() => {
    if (!timeline) return;
    setLoading(true);
    setEntries([]);
    void window.crabwatch.getTimeline(timeline.slug).then((es) => {
      setEntries(es);
      setLoading(false);
    });
  }, [timeline?.slug]);

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

  return (
    <aside className="timeline-panel">
      <header>
        <div>
          <div className="panel-project">📋 {timeline.name} 任务时间线</div>
          <div className="panel-state">
            {loading ? '解析中…' : `${entries.length} sessions`}
          </div>
        </div>
        <button onClick={() => useStore.getState().closeTimeline()}>×</button>
      </header>
      <div className="timeline-body">
        {entries.map((e) => {
          const tok = e.segments.reduce(
            (s, x) => s + x.tokens.input + x.tokens.output,
            0,
          );
          return (
            <div key={e.sessionId} className="session-card">
              <div className="session-card-head">
                <span className={e.relayFromPrev ? 'relay' : 'fresh'}>
                  {e.relayFromPrev ? '│ 接力' : '┌ 新一轮'}
                </span>{' '}
                <b>{e.firstTs?.slice(0, 10)}</b>{' '}
                <span className="dim">{e.sessionId.slice(0, 8)}</span>
                <div className="session-card-title">
                  {e.title ?? '(无标题)'}{' '}
                  <span className="dim">
                    · {e.segments.length} 段 · {fmtTok(tok)} tok
                  </span>
                </div>
              </div>
              {e.segments.map((seg) => (
                <SegRow
                  key={seg.id}
                  seg={seg}
                  transcriptPath={e.transcriptPath}
                  projectName={timeline.name}
                  onRaw={(s, p) => void showRaw(s, p)}
                />
              ))}
            </div>
          );
        })}
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
