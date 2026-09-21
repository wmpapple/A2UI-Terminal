import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { SystemSettings } from './SystemSettings';

const { clearAllLocalDataMock, exportDiagnosticsMock, scheduleApplicationReloadMock } = vi.hoisted(
  () => ({
    clearAllLocalDataMock: vi.fn(),
    exportDiagnosticsMock: vi.fn(),
    scheduleApplicationReloadMock: vi.fn(),
  })
);

vi.mock('../../../app/localData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../app/localData')>()),
  scheduleApplicationReload: scheduleApplicationReloadMock,
}));

vi.mock('../../../shared/platform/runtime', () => ({ getRuntimeMode: () => 'desktop' }));
vi.mock('../../../shared/platform/desktop', () => ({
  desktopApi: {
    exportDiagnostics: exportDiagnosticsMock,
    clearAllLocalData: clearAllLocalDataMock,
    getTelemetrySettings: vi.fn().mockResolvedValue({
      enabled: false,
      invitationEligible: false,
      invitationDismissed: false,
      uploadConfigured: false,
      collectionMode: 'local_only',
      localEventCount: 0,
      eventCounts: {},
      kpis: [],
    }),
    setTelemetrySettings: vi.fn(),
    exportEventDictionary: vi.fn(),
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
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    clearAllLocalDataMock.mockReset().mockResolvedValue({ cleared: true });
    scheduleApplicationReloadMock.mockReset();
    exportDiagnosticsMock.mockReset().mockResolvedValue({
      exported: true,
      fileName: 'a2ui-terminal-diagnostics.json',
    });
  });

  it('clears WebView preferences only after the trusted clear succeeds', async () => {
    localStorage.setItem('a2ui.experience-mode.v1', 'professional');
    sessionStorage.setItem('a2ui.test-session', 'private');
    render(
      <I18nProvider>
        <SystemSettings />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /一键清除所有本地数据/ }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'DELETE_ALL_LOCAL_DATA' },
    });
    fireEvent.click(screen.getByRole('button', { name: '永久清除' }));

    await waitFor(() => expect(clearAllLocalDataMock).toHaveBeenCalledOnce());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(scheduleApplicationReloadMock).toHaveBeenCalledOnce();
  });

  it('preserves WebView preferences when the trusted clear fails', async () => {
    localStorage.setItem('a2ui.experience-mode.v1', 'professional');
    clearAllLocalDataMock.mockRejectedValueOnce(new Error('clear failed'));

    render(
      <I18nProvider>
        <SystemSettings />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /一键清除所有本地数据/ }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'DELETE_ALL_LOCAL_DATA' },
    });
    fireEvent.click(screen.getByRole('button', { name: '永久清除' }));

    await waitFor(() => expect(clearAllLocalDataMock).toHaveBeenCalledOnce());
    expect(localStorage.getItem('a2ui.experience-mode.v1')).toBe('professional');
    expect(scheduleApplicationReloadMock).not.toHaveBeenCalled();
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

  it('resets confirmation after cancel and prevents repeat submission while clearing', async () => {
    let complete!: (value: { cleared: boolean }) => void;
    clearAllLocalDataMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    render(
      <I18nProvider>
        <SystemSettings />
      </I18nProvider>
    );
    const open = () =>
      fireEvent.click(screen.getByRole('button', { name: /一键清除所有本地数据/ }));
    open();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE_ALL_LOCAL_DATA' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /取\s*消/ }));
    expect(clearAllLocalDataMock).not.toHaveBeenCalled();
    open();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: '永久清除' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE_ALL_LOCAL_DATA' } });
    const confirm = screen.getByRole('button', { name: '永久清除' });
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: /取\s*消/ })
    ).toBeDisabled();
    fireEvent.click(confirm);
    expect(clearAllLocalDataMock).toHaveBeenCalledOnce();
    await act(async () => {
      complete({ cleared: true });
    });
  });
});
