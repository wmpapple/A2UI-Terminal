import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { ResultDocument } from '../../../shared/types/domain';
import { resultInitialState, useResultStore } from '../resultStore';
import { ResultAssistantPanel } from './ResultAssistantPanel';
import { ResultWorkbench } from './ResultWorkbench';

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
};

describe('ResultWorkbench', () => {
  beforeEach(() => {
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
