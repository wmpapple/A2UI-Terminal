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

const updateSnapshot = {
  phase: 'current' as 'current' | 'unavailable',
  currentVersion: '0.1.9',
  error: '',
};
vi.mock('../appUpdater', () => ({
  checkForAppUpdate: vi.fn(),
  installPendingUpdate: vi.fn(),
  getUpdateSnapshot: () => updateSnapshot,
  subscribeToUpdates: () => () => undefined,
}));

describe('SystemSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    updateSnapshot.phase = 'current';
    updateSnapshot.error = '';
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

  it('separates updates from privacy and keeps diagnostics in professional mode', () => {
    const { rerender } = render(
      <I18nProvider>
        <SystemSettings view="updates" professional={false} />
      </I18nProvider>
    );
    expect(screen.getByRole('heading', { name: '应用更新' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '诊断' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '危险操作' })).not.toBeInTheDocument();

    rerender(
      <I18nProvider>
        <SystemSettings view="updates" professional />
      </I18nProvider>
    );
    expect(screen.getByRole('heading', { name: '诊断' })).toBeVisible();

    rerender(
      <I18nProvider>
        <SystemSettings view="privacy" />
      </I18nProvider>
    );
    expect(screen.queryByRole('heading', { name: '应用更新' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本地数据' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '危险操作' })).toBeVisible();
  });

  it('hides updater configuration details and unavailable actions', () => {
    updateSnapshot.phase = 'unavailable';
    updateSnapshot.error = 'Updater does not have any endpoints set.';
    render(
      <I18nProvider>
        <SystemSettings view="updates" />
      </I18nProvider>
    );
    expect(screen.getByText(/0\.1\.9/)).toBeVisible();
    expect(screen.queryByText('未配置更新源')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '检查更新' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Updater does not have any endpoints set/)).not.toBeInTheDocument();
  });
});
