import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { OnboardingDialog } from './OnboardingDialog';

describe('OnboardingDialog', () => {
  it('uses three plain-language steps and requires privacy confirmation to finish', () => {
    const onFinish = vi.fn();
    render(
      <I18nProvider>
        <OnboardingDialog open onFinish={onFinish} onSkip={vi.fn()} />
      </I18nProvider>
    );

    const next = screen.getByRole('button', { name: '下一步' });
    expect(next).toBeDisabled();
    expect(screen.queryByText(/Provider|Context|Endpoint/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: '整理一组资料' }));
    fireEvent.click(next);
    expect(
      screen.getByText('资料是可选的。只有你明确选择的内容才会进入任务。')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    const finish = screen.getByRole('button', { name: '完成并进入首页' });
    expect(finish).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(finish);
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it('can be skipped from the first step', () => {
    const onSkip = vi.fn();
    render(
      <I18nProvider>
        <OnboardingDialog open onFinish={vi.fn()} onSkip={onSkip} />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '跳过引导' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });
});
