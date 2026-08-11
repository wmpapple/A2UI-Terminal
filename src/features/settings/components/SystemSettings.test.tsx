import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { SystemSettings } from './SystemSettings';

const { exportDiagnosticsMock } = vi.hoisted(() => ({
  exportDiagnosticsMock: vi.fn(),
}));

vi.mock('../../../shared/platform/runtime', () => ({ getRuntimeMode: () => 'desktop' }));
vi.mock('../../../shared/platform/desktop', () => ({
  desktopApi: {
    exportDiagnostics: exportDiagnosticsMock,
    clearAllLocalData: vi.fn(),
  },
}));

const updateSnapshot = { phase: 'current' as const, currentVersion: '0.1.9' };
vi.mock('../appUpdater', () => ({
  checkForAppUpdate: vi.fn(),
  installPendingUpdate: vi.fn(),
  getUpdateSnapshot: () => updateSnapshot,
  subscribeToUpdates: () => () => undefined,
}));

describe('SystemSettings', () => {
  beforeEach(() => {
    exportDiagnosticsMock.mockReset().mockResolvedValue({
      exported: true,
      fileName: 'a2ui-terminal-diagnostics.json',
    });
  });

  it('exports redacted diagnostics and gates destructive clearing with exact text', async () => {
    render(
      <I18nProvider>
        <SystemSettings />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /导出脱敏诊断/ }));
    await waitFor(() => expect(exportDiagnosticsMock).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: /一键清除所有本地数据/ }));
    const confirm = screen.getByRole('button', { name: '永久清除' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE_ALL' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'DELETE_ALL_LOCAL_DATA' },
    });
    expect(confirm).toBeEnabled();
  });
});
