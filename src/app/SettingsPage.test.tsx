import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { I18nProvider } from './i18n/I18nProvider';
import { useAppStore } from '../stores/useAppStore';
import { SettingsPage } from './SettingsPage';

vi.mock('../features/settings/components/SystemSettings', () => ({
  SystemSettings: ({ view, professional }: { view: string; professional?: boolean }) => (
    <div>{`system:${view}:${professional}`}</div>
  ),
}));
vi.mock('../features/settings/components/WritingProfileSettings', () => ({
  WritingProfileSettings: () => {
    const [draft, setDraft] = useState('');
    return (
      <input
        aria-label="writing-profile-draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));

describe('SettingsPage categories', () => {
  it('keeps one active category and offers model configuration in simple mode', () => {
    useAppStore.setState({
      processingOptions: {
        activeProviderId: 'custom',
        processingLocation: 'local',
        availability: 'ready',
        localProviderAvailable: true,
        availableLocalProviders: 1,
        probeCompleted: true,
      },
      activeProviderId: 'custom',
    });
    const openProvider = vi.fn();
    render(
      <I18nProvider>
        <SettingsPage
          experienceMode="simple"
          onExperienceModeChange={vi.fn()}
          onOpenProviderSettings={openProvider}
        />
      </I18nProvider>
    );

    expect(screen.getByRole('heading', { name: '常规' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: '界面模式' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'AI 与模型' }));
    expect(screen.getByRole('heading', { name: 'AI 与模型' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '界面模式' })).not.toBeInTheDocument();
    expect(screen.getByText('OpenAI-Compatible')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '配置模型' }));
    expect(openProvider).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '写作偏好' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'writing-profile-draft' }), {
      target: { value: '未保存的规则' },
    });
    fireEvent.click(screen.getByRole('button', { name: '更新与诊断' }));
    expect(screen.getByText('system:updates:false')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '隐私与数据' }));
    expect(screen.getByText('system:privacy:undefined')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '写作偏好' }));
    expect(screen.getByRole('textbox', { name: 'writing-profile-draft' })).toHaveValue(
      '未保存的规则'
    );
  });

  it('shows professional mode details and updates the shared mode preference', () => {
    const onModeChange = vi.fn();
    render(
      <I18nProvider>
        <SettingsPage
          experienceMode="professional"
          onExperienceModeChange={onModeChange}
          onOpenProviderSettings={vi.fn()}
        />
      </I18nProvider>
    );
    expect(screen.getByText(/Provider、高级参数/)).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: '界面模式' }), {
      target: { value: 'simple' },
    });
    expect(onModeChange).toHaveBeenCalledWith('simple');
    fireEvent.click(screen.getByRole('button', { name: '更新与诊断' }));
    expect(screen.getByText('system:updates:true')).toBeVisible();
  });
});
