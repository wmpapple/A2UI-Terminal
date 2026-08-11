import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkMock, getVersionMock, relaunchMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  getVersionMock: vi.fn(),
  relaunchMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: getVersionMock }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: relaunchMock }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: checkMock }));
vi.mock('../../shared/platform/runtime', () => ({ getRuntimeMode: () => 'desktop' }));

import { checkForAppUpdate, getUpdateSnapshot, installPendingUpdate } from './appUpdater';

describe('appUpdater', () => {
  beforeEach(() => {
    checkMock.mockReset();
    getVersionMock.mockReset().mockResolvedValue('1.0.0');
    relaunchMock.mockReset().mockResolvedValue(undefined);
  });

  it('checks, reports progress, verifies through the plugin, and relaunches', async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } });
      onEvent({ event: 'Progress', data: { chunkLength: 100 } });
      onEvent({ event: 'Finished', data: {} });
    });
    checkMock.mockResolvedValue({
      version: '1.1.0',
      body: 'Security and stability fixes',
      downloadAndInstall,
    });

    await checkForAppUpdate();
    expect(getUpdateSnapshot()).toMatchObject({
      phase: 'available',
      currentVersion: '1.0.0',
      nextVersion: '1.1.0',
    });

    await installPendingUpdate();
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(getUpdateSnapshot()).toMatchObject({ phase: 'installed', progress: 100 });
    expect(relaunchMock).toHaveBeenCalledOnce();
  });
});
