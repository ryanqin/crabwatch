import type { CrabwatchBridge } from '../../shared/ipc';

declare global {
  interface Window {
    crabwatch: CrabwatchBridge;
  }
}

export {};
