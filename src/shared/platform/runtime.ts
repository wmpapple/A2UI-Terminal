export type RuntimeMode = 'desktop' | 'web-mock';

export const getRuntimeMode = (): RuntimeMode =>
  typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI_IPC__)
    ? 'desktop'
    : 'web-mock';

export const isWebMock = (): boolean => getRuntimeMode() === 'web-mock';
