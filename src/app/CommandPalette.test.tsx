import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n/I18nProvider';
import { CommandPalette } from './CommandPalette';

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<typeof import('antd')>()),
  // Drive the delayed opening callback after the user has focused a field.
  Modal: ({
    children,
    afterOpenChange,
  }: {
    children: ReactNode;
    afterOpenChange: (open: boolean) => void;
  }) => (
    <div role="dialog" onAnimationEnd={() => afterOpenChange(true)}>
      <div tabIndex={0} data-testid="dialog-focus-sentinel" />
      <button data-testid="dialog-default-close">Close</button>
      {children}
    </div>
  ),
}));

describe('command palette delayed opening focus', () => {
  const mount = () =>
    render(
      <I18nProvider>
        <button>Outside</button>
        <CommandPalette
          onClose={vi.fn()}
          onNavigate={vi.fn()}
          onCreate={vi.fn()}
          onOpenWorkbench={vi.fn()}
        />
      </I18nProvider>
    );

  it('keeps focus and text in local search when the opening animation completes', () => {
    mount();
    const search = screen.getByPlaceholderText('输入成果标题、正文关键词或资料名称');
    act(() => search.focus());
    fireEvent.change(search, { target: { value: '调研' } });
    fireEvent.animationEnd(screen.getByRole('dialog'));
    expect(search).toHaveFocus();
    expect(search).toHaveValue('调研');
    expect(screen.getByRole('combobox', { name: '搜索与快捷命令' })).toHaveValue('');
  });

  it('still focuses the command field if focus is outside the dialog', () => {
    mount();
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    fireEvent.animationEnd(screen.getByRole('dialog'));
    expect(screen.getByRole('combobox', { name: '搜索与快捷命令' })).toHaveFocus();
  });

  it.each(['dialog-focus-sentinel', 'dialog-default-close'])(
    'moves initial focus from %s into the command field',
    (testId) => {
      mount();
      act(() => screen.getByTestId(testId).focus());
      fireEvent.animationEnd(screen.getByRole('dialog'));
      expect(screen.getByRole('combobox', { name: '搜索与快捷命令' })).toHaveFocus();
    }
  );
});
