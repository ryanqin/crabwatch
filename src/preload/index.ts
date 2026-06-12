import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CrabwatchBridge, EngineEventMessage } from '../shared/ipc.js';

const bridge: CrabwatchBridge = {
  init: () => ipcRenderer.invoke('cw:init'),
  getRecent: (sessionId, n) => ipcRenderer.invoke('cw:getRecent', sessionId, n),
  onEngineEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, msg: EngineEventMessage) => cb(msg);
    ipcRenderer.on('engine-event', listener);
    return () => ipcRenderer.removeListener('engine-event', listener);
  },
};

contextBridge.exposeInMainWorld('crabwatch', bridge);
