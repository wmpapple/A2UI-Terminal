import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { ResultDocument } from '../../../shared/types/domain';
import { resultInitialState, useResultStore } from '../resultStore';
import { ResultAssistantPanel } from './ResultAssistantPanel';
import { ResultWorkbench } from './ResultWorkbench';
import { resultController } from '../resultController';

const document: ResultDocument = {
  result: {
    id: 'result-1',
    workspaceId: 'workspace-1',
    type: 'document',
    title: '可重开成果',
    status: 'draft',
    storageKind: 'managed_local',
    currentRevisionId: 'revision-1',
    a2uiSurfaceId: null,
    createdAt: '2026-08-17 10:00:00',
    updatedAt: '2026-08-17 10:00:00',
    completedAt: null,
    storageRef: 'result://file/result-1',
    activeSessionId: null,
    managedState: { format: 'markdown' },
  },
  format: 'markdown',
  content: '# 可重开成果\n',
  contentHash: 'a'.repeat(64),
  sizeBytes: 20,
  editable: true,
  appliedReview: null,
  recoveryDraft: null,
};

describe('ResultWorkbench', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useResultStore.setState({
      ...resultInitialState,
      activeDocument: document,
      draftContent: document.content,
      openResult: vi.fn().mockResolvedValue(undefined),
      updateDraft: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      loadRevisions: vi.fn().mockResolvedValue(undefined),
      previewRevision: vi.fn().mockResolvedValue(undefined),
      restoreRevision: vi.fn().mockResolvedValue(undefined),
      undo: vi.fn().mockResolvedValue(undefined),
      duplicate: vi.fn().mockResolvedValue(null),
      clearPreview: vi.fn(),
      clearError: vi.fn(),
    });
  });

  it('keeps the before/after comparison when autosave finishes while the dialog is open', async () => {
    useResultStore.setState({ draftContent: '修改后的正文', saveStatus: 'dirty' });
    render(
      <I18nProvider>
        <ResultWorkbench resultId="result-1" onDuplicated={vi.fn()} onOpenResults={vi.fn()} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /查看修改/ }));
    const dialog = within(screen.getByRole('dialog', { name: '查看修改' }));
    await waitFor(() => expect(dialog.getByText(document.content.trim())).toBeVisible());
    expect(dialog.getByText('修改后的正文')).toBeVisible();
    act(() =>
      useResultStore.setState({
        activeDocument: { ...document, content: '修改后的正文' },
        draftContent: '修改后的正文',
        saveStatus: 'saved',
      })
    );
    expect(dialog.getByText(document.content.trim())).toBeVisible();
    expect(dialog.getByText('修改后的正文')).toBeVisible();
  });

  it('compares a saved document with a different historical version', async () => {
    const old = {
      id: 'old',
      contentHash: 'b'.repeat(64),
      source: 'autosave' as const,
      summary: '保存成果',
      createdAt: document.result.createdAt,
      isCurrent: false,
    };
    vi.spyOn(resultController, 'listRevisions').mockResolvedValue([old]);
    vi.spyOn(resultController, 'readRevision').mockResolvedValue({
      ...old,
      content: '修改前的正文',
    });
    render(
      <I18nProvider>
        <ResultWorkbench resultId="result-1" onDuplicated={vi.fn()} onOpenResults={vi.fn()} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /查看修改/ }));
    const dialog = within(screen.getByRole('dialog', { name: '查看修改' }));
    await waitFor(() => expect(dialog.getByText('修改前的正文')).toBeVisible());
    expect(dialog.getByText(document.content.trim())).toBeVisible();
    expect(resultController.readRevision).toHaveBeenCalledWith('result-1', 'old');
  });

  it('explains when no different version exists instead of showing identical columns', async () => {
    vi.spyOn(resultController, 'listRevisions').mockResolvedValue([]);
    render(
      <I18nProvider>
        <ResultWorkbench resultId="result-1" onDuplicated={vi.fn()} onOpenResults={vi.fn()} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /查看修改/ }));
    const dialog = within(screen.getByRole('dialog', { name: '查看修改' }));
    await waitFor(() =>
      expect(
        dialog.getByText('当前没有未保存的修改，也没有内容不同的历史版本可供对比。')
      ).toBeVisible()
    );
    expect(dialog.queryByText('修改前')).not.toBeInTheDocument();
  });

  it('shows the result-first actions and edits through the Result store', () => {
    const updateDraft = vi.fn();
    useResultStore.setState({ updateDraft });
    render(
      <I18nProvider>
        <ResultWorkbench resultId="result-1" onDuplicated={vi.fn()} onOpenResults={vi.fn()} />
      </I18nProvider>
    );
    expect(screen.getAllByText('可重开成果')).not.toHaveLength(0);
    expect(screen.getByLabelText('成果预览')).toHaveTextContent('可重开成果');
    expect(screen.queryByText('# 可重开成果')).not.toBeInTheDocument();
    expect(screen.getByText(/保存在“我的成果”/)).toBeVisible();
    for (const action of ['保存', '查看修改', '撤销', '历史版本', '另存副本', '导出']) {
      expect(screen.getByRole('button', { name: new RegExp(action) })).toBeVisible();
    }
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.change(screen.getByRole('textbox', { name: '成果编辑器' }), {
      target: { value: '新内容' },
    });
    expect(updateDraft).toHaveBeenCalledWith('新内容');
  });

  it('opens My Results from the managed-location link', () => {
    const onOpenResults = vi.fn();
    render(
      <I18nProvider>
        <ResultWorkbench resultId="result-1" onDuplicated={vi.fn()} onOpenResults={onOpenResults} />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /查看我的成果/ }));
    expect(onOpenResults).toHaveBeenCalledOnce();
  });

  it('allows revision-bound export for a portable A2UI tool result', () => {
    useResultStore.setState({
      activeDocument: {
        ...document,
        result: {
          ...document.result,
          type: 'tool',
          a2uiSurfaceId: 'release-checklist',
          currentRevisionId: 'tool-revision',
        },
        format: 'json',
        content: '{"settings":[{"key":"doneItems","label":"检查项目","value":"完成评审（1/2）"}]}',
        editable: false,
      },
    });
    render(
      <I18nProvider>
        <ResultWorkbench resultId="result-1" onDuplicated={vi.fn()} onOpenResults={vi.fn()} />
      </I18nProvider>
    );
    expect(screen.getByRole('button', { name: /导出/ })).toBeEnabled();
  });

  it('runs the unified AI undo action and presents failures in the result workspace', () => {
    const onUndoReview = vi.fn();
    const appliedReview = { reviewId: 'review-1', workspaceId: 'workspace-source' };
    useResultStore.setState({
      activeDocument: { ...document, appliedReview },
    });
    render(
      <I18nProvider>
        <ResultWorkbench
          resultId="result-1"
          onDuplicated={vi.fn()}
          onOpenResults={vi.fn()}
          reviewUndoError="当前成果已变化，不能直接撤销"
          onUndoReview={onUndoReview}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /撤销上次 AI 修改/ }));
    expect(onUndoReview).toHaveBeenCalledWith(appliedReview);
    expect(screen.getByTestId('review-undo-error')).toHaveTextContent(
      '当前成果已变化，不能直接撤销'
    );
  });

  it('states that AI context is not sent automatically', () => {
    render(
      <I18nProvider>
        <ResultAssistantPanel />
      </I18nProvider>
    );
    expect(screen.getByText('当前成果不会自动发送；任何 AI 读取范围仍需明确确认。')).toBeVisible();
  });
});
