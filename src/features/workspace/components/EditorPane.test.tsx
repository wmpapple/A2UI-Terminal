import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useI18n } from '../../../app/i18n/useI18n';
import { mockFiles } from '../../../shared/mock/workspace';
import { useAppStore } from '../../../stores/useAppStore';
import { EditorPane } from './EditorPane';

const togglePreviewMock = vi.hoisted(() => vi.fn());

vi.mock('md-editor-rt', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const MdEditor = forwardRef(function MockMarkdownEditor(
    { language, preview }: { language: string; preview: boolean },
    ref
  ) {
    useImperativeHandle(ref, () => ({ togglePreview: togglePreviewMock }), []);
    return (
      <div data-testid="markdown-editor" data-language={language} data-preview={String(preview)} />
    );
  });

  return { MdEditor };
});

function LanguageSwitcher() {
  const { setLocale } = useI18n();
  return (
    <button type="button" onClick={() => setLocale('en-US')}>
      Switch to English
    </button>
  );
}

describe('EditorPane modes', () => {
  beforeEach(() => {
    vi.useRealTimers();
    togglePreviewMock.mockClear();
    useAppStore.setState({
      files: mockFiles,
      openPaths: ['README.md'],
      activePath: 'README.md',
      dirtyPaths: [],
      centerView: 'editor',
    });
  });

  it('auto-saves each dirty file on its own one-second schedule', () => {
    vi.useFakeTimers();
    const persistDraft = vi.fn().mockResolvedValue(undefined);
    const saveFileToDisk = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      runtimeMode: 'desktop',
      files: [
        {
          path: 'first.ts',
          name: 'first.ts',
          language: 'typescript',
          content: 'first',
          contentHash: 'first-hash',
          editable: true,
        },
        {
          path: 'second.ts',
          name: 'second.ts',
          language: 'typescript',
          content: 'second',
          contentHash: 'second-hash',
          editable: true,
        },
      ],
      openPaths: ['first.ts', 'second.ts'],
      activePath: 'first.ts',
      dirtyPaths: ['first.ts', 'second.ts'],
      persistDraft,
      saveFileToDisk,
    });

    render(
      <I18nProvider>
        <EditorPane />
      </I18nProvider>
    );

    act(() => vi.advanceTimersByTime(500));
    act(() => useAppStore.getState().updateFile('second.ts', 'second changed'));
    act(() => vi.advanceTimersByTime(500));

    expect(saveFileToDisk).toHaveBeenCalledWith('first.ts');
    expect(saveFileToDisk).not.toHaveBeenCalledWith('second.ts');

    act(() => vi.advanceTimersByTime(500));
    expect(saveFileToDisk).toHaveBeenCalledWith('second.ts');
    vi.useRealTimers();
  });

  it('synchronizes locale and only previews Markdown files', async () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
        <EditorPane />
      </I18nProvider>
    );

    const editor = await screen.findByTestId('markdown-editor');
    expect(editor).toHaveAttribute('data-language', 'zh-CN');
    expect(editor).toHaveAttribute('data-preview', 'false');
    expect(screen.getByRole('button', { name: '开启预览' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    fireEvent.click(screen.getByRole('button', { name: '开启预览' }));
    expect(editor).toHaveAttribute('data-preview', 'true');
    expect(togglePreviewMock).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: '关闭预览' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(editor).toHaveAttribute('data-preview', 'false');
    expect(togglePreviewMock).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: '开启预览' }));
    expect(editor).toHaveAttribute('data-preview', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
    expect(editor).toHaveAttribute('data-language', 'en-US');
    expect(screen.getByRole('button', { name: 'Hide preview' })).toBeInTheDocument();

    act(() => useAppStore.getState().openFile('src/experiment.ts'));
    expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'src/experiment.ts' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide preview' })).not.toBeInTheDocument();
  });

  it('opens persistent version history for editable desktop files', async () => {
    const loadDocumentVersions = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      runtimeMode: 'desktop',
      documentVersions: [],
      versionPreview: null,
      versionHistoryLoading: false,
      versionHistoryError: null,
      loadDocumentVersions,
    });

    render(
      <I18nProvider>
        <EditorPane />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '版本历史' }));

    expect(await screen.findByText('保存文件后，版本会显示在这里')).toBeInTheDocument();
    expect(loadDocumentVersions).toHaveBeenCalledWith('README.md');
  });
});
