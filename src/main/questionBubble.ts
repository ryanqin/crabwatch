import { BrowserWindow, screen } from 'electron';

/**
 * 独立桌面问答气泡窗（学 clawd-on-desk 的 elicitation bubble）：脱离主窗口，
 * 浮在屏幕右上角直接作答——托盘常驻、主窗不开也能选。focusable:true 才能键盘/
 * 点选；复用主窗口 preload，气泡内 inline JS 直接调 window.crabwatch.respondPermission
 * 回传（无需新 IPC 通道）。作答 = allow + updatedInput 预填 answers；to terminal = deny。
 */
const bubbles = new Map<string, BrowserWindow>();

interface QSpec {
  question?: string;
  multiSelect?: boolean;
  options?: { label?: string; description?: string }[];
}

function bubbleHtml(
  permId: string,
  sessionId: string,
  sessionName: string,
  questions: QSpec[],
  toolInput: Record<string, unknown>,
): string {
  // </script> 与属性注入防护：转义 < 即可（JSON 结构本身无 <）
  const data = JSON.stringify({
    permId,
    sessionId,
    sessionName,
    questions,
    toolInput,
  }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset=utf-8><style>
  html,body{margin:0;height:100vh}
  body{font:13px ui-monospace,monospace;background:#171b20;border:2px solid #c79a4e;
    color:#d6d9de;box-sizing:border-box;display:flex;flex-direction:column;
    border-radius:9px;overflow:hidden;-webkit-user-select:none}
  header{padding:9px 12px 6px;color:#c79a4e;font-weight:bold;flex:none}
  .body{padding:0 12px;overflow-y:auto;flex:1}
  .q{margin:4px 0 6px;color:#d6d9de}
  .opt{display:block;width:100%;text-align:left;border:1px solid #313840;background:#1d232a;
    color:#d6d9de;font:inherit;font-size:12px;padding:5px 8px;margin-bottom:4px;
    border-radius:3px;cursor:pointer}
  .opt:hover{border-color:#c79a4e}
  .opt.sel{border-color:#c79a4e;background:#2a2417}
  .other{width:100%;box-sizing:border-box;background:#14181c;border:1px solid #313840;
    color:#d6d9de;font:inherit;font-size:12px;padding:4px 7px;margin:2px 0 8px;border-radius:3px}
  .other:focus{outline:none;border-color:#c79a4e}
  .actions{display:flex;gap:8px;padding:8px 12px;flex:none}
  .actions button{flex:1;font:inherit;font-size:12px;padding:5px 0;border:1px solid #313840;
    background:#232a33;color:#d6d9de;cursor:pointer;border-radius:3px}
  .allow:hover{border-color:#8fbf7a;color:#8fbf7a}
  .deny:hover{border-color:#b85c5c;color:#b85c5c}
  .allow:disabled{opacity:.4;cursor:default}
  .dim{color:#6e7681}
  </style></head><body>
  <header id=hd></header>
  <div class=body id=bd></div>
  <div class=actions>
    <button class=allow id=sub disabled>submit answer</button>
    <button class=deny id=term>to terminal</button>
  </div>
  <script>
  const D = ${data};
  const sel = {}; const other = {};
  document.getElementById('hd').textContent = 'crab ▪ ' + D.sessionName + ' · question';
  const bd = document.getElementById('bd');
  D.questions.forEach((q, qi) => {
    const qt = document.createElement('div'); qt.className='q';
    qt.textContent = q.question || ''; bd.appendChild(qt);
    (q.options||[]).forEach((o) => {
      const b = document.createElement('button'); b.className='opt'; b.setAttribute('data-q', qi);
      const lab = document.createElement('b'); lab.textContent = o.label || ''; b.appendChild(lab);
      if (o.description){ const d=document.createElement('span'); d.className='dim';
        d.textContent=' — '+o.description; b.appendChild(d); }
      b.onclick = () => {
        const k = q.question || '';
        if (q.multiSelect){ sel[k]=sel[k]||[]; const i=sel[k].indexOf(o.label);
          if(i>=0) sel[k].splice(i,1); else sel[k].push(o.label); }
        else sel[k]=[o.label];
        Array.from(bd.querySelectorAll('[data-q="'+qi+'"]')).forEach((el,idx)=>{
          el.classList.toggle('sel', (sel[k]||[]).includes((q.options[idx]||{}).label)); });
        refresh();
      };
      bd.appendChild(b);
    });
    const inp = document.createElement('input'); inp.className='other'; inp.placeholder='other…';
    inp.oninput = () => { other[q.question||'']=inp.value; refresh(); };
    bd.appendChild(inp);
  });
  function answered(){ return D.questions.every((q)=>{ const k=q.question||'';
    return (sel[k]&&sel[k].length) || (other[k]&&other[k].trim()); }); }
  function refresh(){ document.getElementById('sub').disabled = !answered(); }
  document.getElementById('sub').onclick = () => {
    const answers={}; D.questions.forEach((q)=>{ const k=q.question||'';
      answers[k] = (other[k]&&other[k].trim()) ? other[k].trim() : (sel[k]||[]).join(', '); });
    window.crabwatch.respondPermission(D.permId,'allow',Object.assign({},D.toolInput,{answers}));
    window.close();
  };
  document.getElementById('term').onclick = () => {
    window.crabwatch.respondPermission(D.permId,'deny');
    if (D.sessionId) window.crabwatch.focusTerminal(D.sessionId);
    window.close();
  };
  // 50s 自动收（与 hookServer 挂起超时对齐），避免气泡残留
  setTimeout(() => window.close(), 50000);
  </script></body></html>`;
}

export function showQuestionBubble(
  permId: string,
  sessionId: string | undefined,
  sessionName: string,
  toolInput: Record<string, unknown>,
  preloadPath: string,
  onClosed: (permId: string) => void,
): void {
  bubbles.get(permId)?.destroy();
  const questions = (
    Array.isArray(toolInput.questions) ? toolInput.questions : []
  ) as QSpec[];

  const wa = screen.getPrimaryDisplay().workArea;
  const W = 344;
  let H = 72 + 50; // 标题 + 按钮条
  for (const q of questions) H += 30 + (q.options?.length ?? 0) * 44 + 34;
  H = Math.min(H, wa.height - 28);
  const offset = bubbles.size * 14;

  const win = new BrowserWindow({
    width: W,
    height: H,
    x: wa.x + wa.width - W - 14,
    y: wa.y + 14 + offset,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: true,
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: false },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubbles.set(permId, win);

  void win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      bubbleHtml(permId, sessionId ?? '', sessionName, questions, toolInput),
    )}`,
  );
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.on('closed', () => {
    bubbles.delete(permId);
    // 兜底回落：延迟让作答的 allow/deny IPC 先 resolve（已 resolve 则 no-op）
    setTimeout(() => onClosed(permId), 400);
  });
}

/** 决定已从别处（主窗口卡片/超时）作出时关闭对应气泡 */
export function closeQuestionBubble(permId: string): void {
  const w = bubbles.get(permId);
  if (w && !w.isDestroyed()) w.destroy();
}
