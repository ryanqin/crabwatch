import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MiniRoster } from './panels/MiniRoster';
import './index.css';

// 同一份 renderer 服务两种窗口：主窗 = App；略缩悬浮窗加载 `#roster` → 只渲染 MiniRoster
const isRoster = window.location.hash === '#roster';
if (isRoster) document.documentElement.classList.add('roster-mode');

// 白天/黑夜：先用缓存的 resolved 同步上 class 防闪，再向 main 取真值 + 订阅系统/手动变化。
// 主窗与浮窗共用此入口，两窗都会跟着切。
function applyTheme(t: 'light' | 'dark') {
  const cls = `theme-${t}`;
  document.documentElement.classList.remove('theme-dark', 'theme-light');
  document.documentElement.classList.add(cls);
  try {
    localStorage.setItem('cw-theme-class', cls);
  } catch {
    /* ignore */
  }
}
try {
  applyTheme(
    localStorage.getItem('cw-theme-class') === 'theme-light' ? 'light' : 'dark',
  );
} catch {
  applyTheme('dark');
}
void window.crabwatch?.getTheme?.().then(applyTheme).catch(() => {});
window.crabwatch?.onTheme?.(applyTheme);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isRoster ? <MiniRoster /> : <App />}</React.StrictMode>,
);
