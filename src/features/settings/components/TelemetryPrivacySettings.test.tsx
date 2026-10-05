import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import telemetry from '../../../../contracts/v2/telemetry.json';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { TelemetryPrivacySettings } from './TelemetryPrivacySettings';

const { getSettings, setSettings, getDictionary } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  getDictionary: vi.fn(),
}));

vi.mock('../../../shared/platform/runtime', () => ({ getRuntimeMode: () => 'desktop' }));
vi.mock('../systemController', () => ({
  systemController: {
    getTelemetrySettings: getSettings,
    setTelemetrySettings: setSettings,
    exportEventDictionary: getDictionary,
  },
}));

describe('TelemetryPrivacySettings', () => {
  beforeEach(() => {
    getSettings.mockReset().mockResolvedValue(telemetry.settings);
    setSettings.mockReset().mockResolvedValue({
      ...telemetry.settings,
      enabled: true,
      invitationDismissed: true,
    });
    getDictionary.mockReset().mockResolvedValue(telemetry.dictionary);
  });

  it('is opt-in and exposes collected fields before enabling', async () => {
    render(
      <I18nProvider>
        <TelemetryPrivacySettings />
      </I18nProvider>
    );

    const toggle = await screen.findByRole('switch', { name: '帮助改进产品' });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText('任务完成率')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /查看将发送的数据/ }));
    await waitFor(() => expect(getDictionary).toHaveBeenCalledOnce());
    expect(await screen.findByText('匿名事件字段字典')).toBeInTheDocument();
    expect(screen.getByText('task_completed')).toBeInTheDocument();
    expect(screen.getByText('document_content')).toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith(true, false));
  });

  it('shows exports of pre-existing results even without a creation baseline', async () => {
    getSettings.mockResolvedValueOnce({
      ...telemetry.settings,
      enabled: true,
      localEventCount: 1,
      eventCounts: { result_exported: 1 },
      kpis: telemetry.settings.kpis.map((kpi) =>
        kpi.key === 'export_save_rate' ? { ...kpi, numerator: 1 } : kpi
      ),
    });
    render(
      <I18nProvider>
        <TelemetryPrivacySettings />
      </I18nProvider>
    );
    expect(await screen.findByText('已记录次数: 1 · 缺少比例计算基数')).toBeInTheDocument();
    expect(screen.queryByText(/100\.0%/)).not.toBeInTheDocument();
  });

  it('keeps empty KPI tiles hidden when collection is enabled without samples', async () => {
    getSettings.mockResolvedValueOnce({
      ...telemetry.settings,
      enabled: true,
      kpis: telemetry.settings.kpis.map((kpi) => ({ ...kpi, numerator: 0, denominator: 0 })),
    });
    render(
      <I18nProvider>
        <TelemetryPrivacySettings />
      </I18nProvider>
    );
    expect(await screen.findByText(/暂无足够本地样本/)).toBeVisible();
    expect(screen.queryByText('任务完成率')).not.toBeInTheDocument();
  });
});
