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
  setQuestionBubble: (on) => ipcRenderer.invoke('cw:setQuestionBubble', on),
  focusTerminal: (sessionId) =>
    ipcRenderer.invoke('cw:focusTerminal', sessionId),
  sendToSession: (sessionId, text, submit) =>
    ipcRenderer.invoke('cw:sendToSession', sessionId, text, submit),
  setFloating: (on) => ipcRenderer.invoke('cw:setFloating', on),
  getFloating: () => ipcRenderer.invoke('cw:getFloating'),
  openMain: (sessionId) => ipcRenderer.invoke('cw:openMain', sessionId),
  reportFloatingHeight: (height) =>
    ipcRenderer.send('cw:reportFloatingHeight', height),
  onFocusSession: (cb) => {
    const listener = (_e: IpcRendererEvent, id: string) => cb(id);
    ipcRenderer.on('cw:focusSession', listener);
    return () => ipcRenderer.removeListener('cw:focusSession', listener);
  },
  showPopup: (title, body) => ipcRenderer.invoke('cw:showPopup', title, body),
  reportBubbleHeight: (permId, height) =>
    ipcRenderer.send('cw:reportBubbleHeight', permId, height),
  story: (slug, projectName, sinceTs, force) =>
    ipcRenderer.invoke('cw:story', slug, projectName, sinceTs, force),
  runDoctor: () => ipcRenderer.invoke('cw:runDoctor'),
  reinstallHooks: () => ipcRenderer.invoke('cw:reinstallHooks'),
  remoteList: () => ipcRenderer.invoke('cw:remoteList'),
  remoteUpsert: (p) => ipcRenderer.invoke('cw:remoteUpsert', p),
  remoteRemove: (id) => ipcRenderer.invoke('cw:remoteRemove', id),
  remoteConnect: (id) => ipcRenderer.invoke('cw:remoteConnect', id),
  remoteDisconnect: (id) => ipcRenderer.invoke('cw:remoteDisconnect', id),
  remoteDeploy: (id) => ipcRenderer.invoke('cw:remoteDeploy', id),
  respondPermission: (id, behavior, extra) =>
    ipcRenderer.invoke('cw:respondPermission', id, behavior, extra),
  onEngineEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, msg: EngineEventMessage) => cb(msg);
    ipcRenderer.on('engine-event', listener);
    return () => ipcRenderer.removeListener('engine-event', listener);
  },
};

contextBridge.exposeInMainWorld('crabwatch', bridge);
