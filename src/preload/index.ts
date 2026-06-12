import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CrabwatchBridge, EngineEventMessage } from '../shared/ipc.js';

const bridge: CrabwatchBridge = {
  init: () => ipcRenderer.invoke('cw:init'),
  getRecent: (sessionId, n) => ipcRenderer.invoke('cw:getRecent', sessionId, n),
  listProjects: () => ipcRenderer.invoke('cw:listProjects'),
  getTimeline: (slug) => ipcRenderer.invoke('cw:getTimeline', slug),
  getRaw: (transcriptPath, byteStart, byteEnd) =>
    ipcRenderer.invoke('cw:getRaw', transcriptPath, byteStart, byteEnd),
  summarize: (seg, projectName) =>
    ipcRenderer.invoke('cw:summarize', seg, projectName),
  organize: (slug, cachedOnly) =>
    ipcRenderer.invoke('cw:organize', slug, cachedOnly),
  getUsage: () => ipcRenderer.invoke('cw:getUsage'),
  getAutoLaunch: () => ipcRenderer.invoke('cw:getAutoLaunch'),
  setAutoLaunch: (on) => ipcRenderer.invoke('cw:setAutoLaunch', on),
  setPermissionCards: (on) => ipcRenderer.invoke('cw:setPermissionCards', on),
  focusTerminal: (sessionId) =>
    ipcRenderer.invoke('cw:focusTerminal', sessionId),
  respondPermission: (id, behavior) =>
    ipcRenderer.invoke('cw:respondPermission', id, behavior),
  onEngineEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, msg: EngineEventMessage) => cb(msg);
    ipcRenderer.on('engine-event', listener);
    return () => ipcRenderer.removeListener('engine-event', listener);
  },
};

contextBridge.exposeInMainWorld('crabwatch', bridge);
