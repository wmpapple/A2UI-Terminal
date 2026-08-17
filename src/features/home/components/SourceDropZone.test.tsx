import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useAppStore } from '../../../stores/useAppStore';
import { SourceDropZone } from './SourceDropZone';

describe('SourceDropZone', () => {
  beforeEach(() => {
    useAppStore.setState({
      workspace: null,
      workspaceEntries: [],
      files: [],
      workspaceLoading: false,
      workspaceError: null,
    });
  });

  it('routes clicks and drops through the existing trusted file-selection action', () => {
    const selectContextFiles = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ selectContextFiles });
    render(
      <I18nProvider>
        <SourceDropZone />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /选择资料$/ }));
    fireEvent.drop(screen.getByTestId('home-source-drop-zone'));
    expect(selectContextFiles).toHaveBeenCalledTimes(2);
  });
});
