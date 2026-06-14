import { useEffect, useState } from 'react';
import type { DoctorReport } from '../../../shared/ipc';

const ICON: Record<string, string> = { pass: '✓', warn: '▲', critical: '✗' };

/** 一键自诊断面板（学 clawd 的 doctor）：hook 装没装 / 在不在收事件 / 有没有被抢占 */
export function DoctorModal({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<DoctorReport>();
  const [running, setRunning] = useState(true);
  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState(false);

  async function run() {
    setRunning(true);
    try {
      setReport(await window.crabwatch.runDoctor());
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void run();
  }, []);

  async function reinstall() {
    setFixing(true);
    try {
      await window.crabwatch.reinstallHooks();
      setFixed(true);
      await run();
    } finally {
      setFixing(false);
    }
  }

  const needsReinstall = report?.checks.some(
    (c) => c.hint?.toLowerCase().includes('reinstall') && c.status !== 'pass',
  );

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal doctor-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <span>
            diagnostics{' '}
            {report && (
              <span className={`doc-overall ${report.overall}`}>
                {ICON[report.overall]} {report.overall}
              </span>
            )}
          </span>
          <span>
            <button
              className="toolbar-btn"
              onClick={() => void run()}
              disabled={running}
            >
              {running ? 'checking…' : 'recheck'}
            </button>{' '}
            <button onClick={onClose}>×</button>
          </span>
        </header>
        <div className="doctor-body">
          {running && !report && <div className="dim">running checks…</div>}
          {report?.checks.map((c) => (
            <div key={c.id} className={`doc-row ${c.status}`}>
              <div className="doc-head">
                <span className="doc-icon">{ICON[c.status]}</span>
                <b>{c.label}</b>
              </div>
              <div className="doc-detail">{c.detail}</div>
              {c.hint && <div className="doc-hint">→ {c.hint}</div>}
            </div>
          ))}
          {(needsReinstall || fixed) && (
            <button
              className="doc-fix"
              onClick={() => void reinstall()}
              disabled={fixing}
            >
              {fixing
                ? 'reinstalling hooks…'
                : fixed
                  ? 'hooks reinstalled ✓ — recheck above'
                  : 'reinstall hooks'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
