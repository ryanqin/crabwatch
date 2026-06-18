import { BrowserWindow, screen } from 'electron';

/**
 * 独立桌面提示气泡窗（学 clawd-on-desk 的 bubble，复刻其全部气泡形态）：脱离主窗口，
 * 浮在屏幕右上角直接作答——托盘常驻、主窗不开也能处理。focusable:true 才能键盘/点选；
 * 复用主窗口 preload，气泡内 inline JS 直接调 window.crabwatch.respondPermission 回传。
 *
 * 三种形态：
 *  - question  (AskUserQuestion / Elicitation)：选项表单，allow + updatedInput.answers
 *  - plan      (ExitPlanMode)：计划正文 + approve(allow) / keep planning(deny) / to terminal
 *  - permission(其余工具)：工具+入参摘要 + allow / deny / always-allow(updatedPermissions) / to terminal
 * to terminal = 无意见（{}），Claude Code 优雅回落终端。
 */
const bubbles = new Map<string, BrowserWindow>();

export type BubbleKind = 'question' | 'plan' | 'permission';

interface QSpec {
  question?: string;
  multiSelect?: boolean;
  options?: { label?: string; description?: string }[];
}

export interface PromptBubbleOpts {
  permId: string;
  sessionId?: string;
  sessionName: string;
  kind: BubbleKind;
  toolName: string;
  toolInput: Record<string, unknown>;
  suggestions?: unknown[];
  preloadPath: string;
  onClosed: (permId: string) => void;
}

function estimateHeight(o: PromptBubbleOpts): number {
  const head = 72;
  const actions = 50;
  if (o.kind === 'question') {
    const qs = (
      Array.isArray(o.toolInput.questions) ? o.toolInput.questions : []
    ) as QSpec[];
    let h = head + actions;
    for (const q of qs) h += 30 + (q.options?.length ?? 0) * 44 + 34;
    return h;
  }
  if (o.kind === 'plan') return head + 200 + actions;
  // permission: header + input block + suggestion buttons
  return head + 96 + (o.suggestions?.length ?? 0) * 34 + actions;
}

function bubbleHtml(o: PromptBubbleOpts): string {
  const data = JSON.stringify({
    permId: o.permId,
    sessionId: o.sessionId ?? '',
    sessionName: o.sessionName,
    kind: o.kind,
    toolName: o.toolName,
    toolInput: o.toolInput,
    suggestions: o.suggestions ?? [],
  }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset=utf-8><style>
  html,body{margin:0;height:100vh}
  body{font:13px ui-monospace,monospace;background:#171b20;border:2px solid #c79a4e;
    color:#d6d9de;box-sizing:border-box;display:flex;flex-direction:column;
    border-radius:9px;overflow:hidden;-webkit-user-select:none}
  header{padding:9px 12px 6px;color:#c79a4e;font-weight:bold;flex:none}
  .body{padding:0 12px;overflow-y:auto;flex:1}
  /* 内容包一层 BFC：量它的 offsetHeight = 自然高度，不被 .body 的 flex 撑高影响 */
  #inner{display:flow-root}
  .q{margin:4px 0 6px;color:#d6d9de}
  .opt{display:block;width:100%;text-align:left;border:1px solid #313840;background:#1d232a;
    color:#d6d9de;font:inherit;font-size:12px;padding:5px 8px;margin-bottom:4px;
    border-radius:3px;cursor:pointer}
  .opt:hover{border-color:#c79a4e}
  .opt.sel{border-color:#c79a4e;background:#2a2417}
  .other{width:100%;box-sizing:border-box;background:#14181c;border:1px solid #313840;
    color:#d6d9de;font:inherit;font-size:12px;padding:4px 7px;margin:2px 0 8px;border-radius:3px}
  .other:focus{outline:none;border-color:#c79a4e}
  .cmd{margin:0;white-space:pre-wrap;word-break:break-all;background:#1d232a;
    padding:5px 7px;border-radius:3px;color:#c3c8cd;font-size:12px}
  .desc{color:#a4abb5;margin-bottom:5px}
  .sug{display:block;width:100%;text-align:left;border:1px solid #3a4a36;background:#1c241a;
    color:#9ec98a;font:inherit;font-size:12px;padding:4px 8px;margin:4px 0 0;border-radius:3px;cursor:pointer}
  .sug:hover{border-color:#8fbf7a}
  .actions{display:flex;gap:8px;padding:8px 12px;flex:none;flex-wrap:wrap}
  .actions button{flex:1;min-width:80px;font:inherit;font-size:12px;padding:5px 0;border:1px solid #313840;
    background:#232a33;color:#d6d9de;cursor:pointer;border-radius:3px}
  .allow:hover{border-color:#8fbf7a;color:#8fbf7a}
  .deny:hover{border-color:#b85c5c;color:#b85c5c}
  .term:hover{border-color:#7a9bd0;color:#7a9bd0}
  .allow:disabled{opacity:.4;cursor:default}
  .dim{color:#6e7681}
  </style></head><body>
  <header id=hd></header>
  <div class=body id=bd></div>
  <div class=actions id=ac></div>
  <script>
  const D = ${data};
  const R = (b, extra) => window.crabwatch.respondPermission(D.permId, b, extra);
  const toTerminal = () => { R(undefined); if (D.sessionId) window.crabwatch.focusTerminal(D.sessionId); window.close(); };
  // 内容都 append 进 #inner（bd 变量指向它），外层 .body 负责 clamp 时的滚动兜底
  const bdOuter = document.getElementById('bd');
  const bd = document.createElement('div'); bd.id = 'inner'; bdOuter.appendChild(bd);
  const ac = document.getElementById('ac');
  function btn(cls, text, on){ const b=document.createElement('button'); b.className=cls; b.textContent=text; b.onclick=on; return b; }

  if (D.kind === 'question') {
    document.getElementById('hd').textContent = 'crab ▪ ' + D.sessionName + ' · question';
    const qs = Array.isArray(D.toolInput.questions) ? D.toolInput.questions : [];
    const sel = {}; const other = {};
    qs.forEach((q, qi) => {
      const qt=document.createElement('div'); qt.className='q'; qt.textContent=q.question||''; bd.appendChild(qt);
      (q.options||[]).forEach((o)=>{
        const b=document.createElement('button'); b.className='opt'; b.setAttribute('data-q',qi);
        const lab=document.createElement('b'); lab.textContent=o.label||''; b.appendChild(lab);
        if(o.description){const d=document.createElement('span');d.className='dim';d.textContent=' — '+o.description;b.appendChild(d);}
        b.onclick=()=>{ const k=q.question||'';
          if(q.multiSelect){sel[k]=sel[k]||[];const i=sel[k].indexOf(o.label);if(i>=0)sel[k].splice(i,1);else sel[k].push(o.label);}
          else sel[k]=[o.label];
          Array.from(bd.querySelectorAll('[data-q="'+qi+'"]')).forEach((el,idx)=>{el.classList.toggle('sel',(sel[k]||[]).includes((q.options[idx]||{}).label));});
          refresh(); };
        bd.appendChild(b);
      });
      const inp=document.createElement('input'); inp.className='other'; inp.placeholder='other…';
      inp.oninput=()=>{other[q.question||'']=inp.value;refresh();}; bd.appendChild(inp);
    });
    const sub=btn('allow','submit answer',()=>{
      const answers={}; qs.forEach((q)=>{const k=q.question||'';answers[k]=(other[k]&&other[k].trim())?other[k].trim():(sel[k]||[]).join(', ');});
      R('allow',{updatedInput:Object.assign({},D.toolInput,{answers})}); window.close(); });
    sub.disabled=true; sub.id='sub'; ac.appendChild(sub);
    ac.appendChild(btn('deny term','to terminal',toTerminal));
    function answered(){return qs.every((q)=>{const k=q.question||'';return (sel[k]&&sel[k].length)||(other[k]&&other[k].trim());});}
    function refresh(){document.getElementById('sub').disabled=!answered();}

  } else if (D.kind === 'plan') {
    document.getElementById('hd').textContent = 'crab ▪ ' + D.sessionName + ' · plan review';
    const pre=document.createElement('div'); pre.className='cmd'; pre.style.maxHeight='200px';
    pre.textContent = (typeof D.toolInput.plan==='string'?D.toolInput.plan:JSON.stringify(D.toolInput,null,2));
    bd.appendChild(pre);
    ac.appendChild(btn('allow','approve',()=>{R('allow');window.close();}));
    ac.appendChild(btn('deny','keep planning',()=>{R('deny');window.close();}));
    ac.appendChild(btn('term','to terminal',toTerminal));

  } else {
    document.getElementById('hd').textContent = 'crab ▪ ' + D.sessionName + ' · ' + D.toolName;
    const inp = D.toolInput || {};
    if (typeof inp.description==='string'){const d=document.createElement('div');d.className='desc';d.textContent=inp.description;bd.appendChild(d);}
    const pre=document.createElement('div'); pre.className='cmd';
    pre.textContent = typeof inp.command==='string' ? inp.command
      : typeof inp.file_path==='string' ? inp.file_path
      : Object.keys(inp).length ? JSON.stringify(inp,null,1) : '(no input)';
    bd.appendChild(pre);
    (D.suggestions||[]).forEach((s)=>{
      let label='always allow';
      try{ if(s && s.type==='addRules' && Array.isArray(s.rules) && s.rules[0]){
        const r=s.rules[0]; label='always allow '+(r.toolName||'')+(r.ruleContent?(' '+r.ruleContent):''); }
        else if(s && s.type==='setMode'){ label='switch to '+s.mode+' mode'; } }catch(e){}
      bd.appendChild(btn('sug', label.slice(0,60), ()=>{ R('allow',{updatedPermissions:[s]}); window.close(); }));
    });
    ac.appendChild(btn('allow','allow',()=>{R('allow');window.close();}));
    ac.appendChild(btn('deny','deny',()=>{R('deny');window.close();}));
    ac.appendChild(btn('term','to terminal',toTerminal));
  }
  // 自适应高度（学 clawd）：量内容自然高度回传，main setSize 调窗口跟随，超屏才滚
  const hd = document.querySelector('header');
  function reportH(){
    try { window.crabwatch.reportBubbleHeight(
      D.permId, hd.offsetHeight + bd.offsetHeight + ac.offsetHeight + 4); } catch(e){}
  }
  new ResizeObserver(reportH).observe(bd);
  requestAnimationFrame(reportH);
  // 兜底自收（正常由 onClosed/prompt 流程关掉）；必须 ＞ hookServer 的 5 分钟 hold，别提前收
  setTimeout(() => window.close(), 370000);
  </script></body></html>`;
}

const BUBBLE_W = 344;

export function showQuestionBubble(opts: PromptBubbleOpts): void {
  bubbles.get(opts.permId)?.destroy();

  const wa = screen.getPrimaryDisplay().workArea;
  const W = BUBBLE_W;
  const H = Math.min(estimateHeight(opts), wa.height - 28);
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
    webPreferences: { preload: opts.preloadPath, contextIsolation: true, sandbox: false },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubbles.set(opts.permId, win);

  void win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(bubbleHtml(opts))}`,
  );
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.on('closed', () => {
    bubbles.delete(opts.permId);
    // 兜底回落：延迟让作答的 allow/deny IPC 先 resolve（已 resolve 则 no-op）
    setTimeout(() => opts.onClosed(opts.permId), 400);
  });
}

/** renderer 量出内容真实高度后调窗口（学 clawd 的 reportHeight→setBounds）；钳在屏幕高内，超了才靠 .body 内滚 */
export function setBubbleHeight(permId: string, height: number): void {
  const w = bubbles.get(permId);
  if (!w || w.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const h = Math.min(Math.max(Math.round(height), 90), wa.height - 28);
  const [, curH] = w.getSize();
  if (Math.abs(curH - h) > 1) w.setSize(BUBBLE_W, h); // 左上角锚定，向下增减，右上角不动
}

/** 决定已从别处（超时）作出时关闭对应气泡 */
export function closeQuestionBubble(permId: string): void {
  const w = bubbles.get(permId);
  if (w && !w.isDestroyed()) w.destroy();
}
