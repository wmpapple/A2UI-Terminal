import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n/I18nProvider';
import { SettingsPage } from './SettingsPage';

vi.mock('../features/settings/components/SystemSettings', () => ({
  SystemSettings: () => <div>safe system settings</div>,
}));

describe('SettingsPage experience modes', () => {
  it('keeps Provider technical settings out of simple mode', () => {
    const onModeChange = vi.fn();
    const onOpenProviderSettings = vi.fn();
    render(
      <I18nProvider>
        <SettingsPage
          experienceMode="simple"
          onExperienceModeChange={onModeChange}
          onOpenProviderSettings={onOpenProviderSettings}
        />
      </I18nProvider>
    );

    expect(screen.getByText(/默认隐藏项目文件/)).toBeInTheDocument();
    expect(screen.queryByText(/Endpoint/)).not.toBeInTheDocument();
    expect(screen.queryByText(/API Key/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Provider 高级设置/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('专业模式', { exact: true }));
    expect(onModeChange).toHaveBeenCalledWith('professional');
  });

  it('offers the existing advanced Provider settings only in professional mode', () => {
    const onOpenProviderSettings = vi.fn();
    render(
      <I18nProvider>
        <SettingsPage
          experienceMode="professional"
          onExperienceModeChange={vi.fn()}
          onOpenProviderSettings={onOpenProviderSettings}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /Provider 高级设置/ }));
    expect(onOpenProviderSettings).toHaveBeenCalledOnce();
  });
});
