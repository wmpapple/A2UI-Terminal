import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n/I18nProvider';
import { lazyFeature } from './lazyFeature';

it('retries a failed module without reloading the application', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const load = vi
    .fn<() => Promise<{ default: () => React.ReactNode }>>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ default: () => <div>Module ready</div> });
  const Page = lazyFeature(load);
  try {
    render(
      <I18nProvider>
        <input aria-label="kept draft" defaultValue="draft" />
        <Page />
      </I18nProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: '重新加载此模块' }));
    expect(await screen.findByText('Module ready')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'kept draft' })).toHaveValue('draft');
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    consoleError.mockRestore();
  }
});
