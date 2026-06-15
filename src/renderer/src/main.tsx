import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MiniRoster } from './panels/MiniRoster';
import './index.css';

// 同一份 renderer 服务两种窗口：主窗 = App；略缩悬浮窗加载 `#roster` → 只渲染 MiniRoster
const isRoster = window.location.hash === '#roster';
if (isRoster) document.documentElement.classList.add('roster-mode');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isRoster ? <MiniRoster /> : <App />}</React.StrictMode>,
);
