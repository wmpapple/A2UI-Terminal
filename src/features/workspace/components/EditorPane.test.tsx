import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useI18n } from '../../../app/i18n/useI18n';
import { mockFiles } from '../../../shared/mock/workspace';
import { useAppStore } from '../../../stores/useAppStore';
import { EditorPane } from './EditorPane';

const togglePreviewMock = vi.hoisted(() => vi.fn());
const editorLifecycleMock = vi.hoisted(() => ({
  nextMountId: 0,
  changeCallbacks: new Map<number, (value: string) => void>(),
}));

vi.mock('md-editor-rt', async () => {
  const { forwardRef, useEffect, useImperativeHandle, useState } = await import('react');
  const MdEditor = forwardRef(function MockMarkdownEditor(
    {
      language,
      preview,
      modelValue,
      onChange,
    }: {
      language: string;
      preview: boolean;
      modelValue: string;
      onChange: (value: string) => void;
    },
    ref
  ) {
    const [mountId] = useState(() => ++editorLifecycleMock.nextMountId);
    useImperativeHandle(ref, () => ({ togglePreview: togglePreviewMock }), []);
    useEffect(() => {
      editorLifecycleMock.changeCallbacks.set(mountId, onChange);
      return () => {
        editorLifecycleMock.changeCallbacks.delete(mountId);
      };
    }, [mountId, onChange]);
    return (
      <div
        data-testid="markdown-editor"
        data-language={language}
        data-preview={String(preview)}
        data-model-value={modelValue}
        data-mount-id={mountId}
      />
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
    editorLifecycleMock.changeCallbacks.clear();
    useAppStore.setState({
      workspace: {
        id: 'workspace-a',
        name: 'Workspace A',
        available: true,
        kind: 'directory',
      },
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

    expect(saveFileToDisk).toHaveBeenCalledWith('first.ts', 'workspace-a');
    expect(saveFileToDisk).not.toHaveBeenCalledWith('second.ts', 'workspace-a');

    act(() => vi.advanceTimersByTime(500));
    expect(saveFileToDisk).toHaveBeenCalledWith('second.ts', 'workspace-a');
    vi.useRealTimers();
  });

  it('cancels pending autosave timers while a workspace transition is loading', () => {
    vi.useFakeTimers();
    const persistDraft = vi.fn().mockResolvedValue(undefined);
    const saveFileToDisk = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      runtimeMode: 'desktop',
      workspaceLoading: false,
      files: [
        {
          path: 'notes.md',
          name: 'notes.md',
          language: 'markdown',
          content: 'changed',
          contentHash: 'notes-hash',
          editable: true,
        },
      ],
      openPaths: ['notes.md'],
      activePath: 'notes.md',
      dirtyPaths: ['notes.md'],
      persistDraft,
      saveFileToDisk,
    });

    render(
      <I18nProvider>
        <EditorPane />
      </I18nProvider>
    );
    act(() => useAppStore.setState({ workspaceLoading: true }));
    act(() => vi.advanceTimersByTime(1500));

    expect(persistDraft).not.toHaveBeenCalled();
    expect(saveFileToDisk).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('remounts the editor and rejects a stale change callback after switching workspaces', async () => {
    useAppStore.setState({
      files: [
        {
          path: 'notes.md',
          name: 'notes.md',
          language: 'markdown',
          content: 'Workspace A content',
          contentHash: 'hash-a',
          editable: true,
        },
      ],
      openPaths: ['notes.md'],
      activePath: 'notes.md',
      dirtyPaths: [],
    });

    render(
      <I18nProvider>
        <EditorPane />
      </I18nProvider>
    );

    const firstEditor = await screen.findByTestId('markdown-editor');
    const firstMountId = Number(firstEditor.dataset.mountId);
    const staleChange = editorLifecycleMock.changeCallbacks.get(firstMountId);
    expect(staleChange).toBeDefined();

    act(() => {
      useAppStore.setState({
        workspace: {
          id: 'workspace-b',
          name: 'Workspace B',
          available: true,
          kind: 'directory',
        },
        files: [
          {
            path: 'notes.md',
            name: 'notes.md',
            language: 'markdown',
            content: 'Workspace B content',
            contentHash: 'hash-b',
            editable: true,
          },
        ],
        openPaths: ['notes.md'],
        activePath: 'notes.md',
        dirtyPaths: [],
      });
    });

    const secondEditor = screen.getByTestId('markdown-editor');
    expect(Number(secondEditor.dataset.mountId)).not.toBe(firstMountId);
    expect(secondEditor).toHaveAttribute('data-model-value', 'Workspace B content');

    act(() => staleChange?.('Workspace A content'));

    expect(useAppStore.getState().files[0].content).toBe('Workspace B content');
    expect(useAppStore.getState().dirtyPaths).toEqual([]);
  });

  it('does not turn a zero-byte Markdown file into a newline on editor initialization', async () => {
    useAppStore.setState({
      files: [
        {
          path: 'empty.md',
          name: 'empty.md',
          language: 'markdown',
          content: '',
          contentHash: 'empty-hash',
          editable: true,
        },
      ],
      openPaths: ['empty.md'],
      activePath: 'empty.md',
      dirtyPaths: [],
    });

    render(
      <I18nProvider>
        <EditorPane />
      </I18nProvider>
    );

    const editor = await screen.findByTestId('markdown-editor');
    const change = editorLifecycleMock.changeCallbacks.get(Number(editor.dataset.mountId));
    expect(change).toBeDefined();

    act(() => change?.('\n'));
    expect(useAppStore.getState().files[0].content).toBe('');
    expect(useAppStore.getState().dirtyPaths).toEqual([]);

    act(() => change?.('# 首段\n'));
    expect(useAppStore.getState().files[0].content).toBe('# 首段\n');
    expect(useAppStore.getState().dirtyPaths).toEqual(['empty.md']);
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

  it('keeps file selection visible in simple mode without rendering the file tree', () => {
    const selectContextFiles = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      files: [],
      openPaths: [],
      activePath: '',
      workspaceLoading: false,
      workspaceError: null,
      selectContextFiles,
    });

    render(
      <I18nProvider>
        <EditorPane showInspector={false} showSimpleFileActions />
      </I18nProvider>
    );

    expect(screen.getByText('选择文件后即可查看、编辑或让 AI 协助处理')).toBeInTheDocument();
    const chooseFileButtons = screen.getAllByRole('button', { name: /选择文件/ });
    expect(chooseFileButtons).toHaveLength(2);
    fireEvent.click(chooseFileButtons[0]);
    expect(selectContextFiles).toHaveBeenCalledOnce();
  });
});
