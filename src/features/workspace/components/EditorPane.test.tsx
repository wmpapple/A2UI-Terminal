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
    togglePreviewMock.mockClear();
    useAppStore.setState({
      files: mockFiles,
      openPaths: ['README.md'],
      activePath: 'README.md',
      dirtyPaths: [],
      centerView: 'editor',
    });
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
    expect(editor).toHaveAttribute('data-preview', 'false');
    expect(screen.queryByRole('button', { name: 'Hide preview' })).not.toBeInTheDocument();
  });
});
