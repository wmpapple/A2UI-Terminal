import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useAppStore } from '../../../stores/useAppStore';
import { ContextSelector } from './ContextSelector';

const initialSelection = {
  selection: false,
  currentFile: true,
  recentMessages: true,
  recentMessageCount: 3,
  projectFiles: [],
};

describe('ContextSelector', () => {
  it('shows the captured editor selection length', () => {
    useAppStore.setState({ selectedText: 'selected text' });
    render(
      <I18nProvider>
        <ContextSelector
          open
          prompt="test"
          initialSelection={initialSelection}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </I18nProvider>
    );
    expect(screen.getByText('13 chars')).toBeInTheDocument();
  });

  it('disables selection context when no editor text is selected', () => {
    useAppStore.setState({ selectedText: '' });
    render(
      <I18nProvider>
        <ContextSelector
          open
          prompt="test"
          initialSelection={initialSelection}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </I18nProvider>
    );
    expect(screen.getByRole('checkbox', { name: /当前选区/ })).toBeDisabled();
  });
});
