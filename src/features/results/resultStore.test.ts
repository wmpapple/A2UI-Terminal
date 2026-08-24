import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultDocument, ResultRevisionSummary } from '../../shared/types/domain';
import { resultController } from './resultController';
import { resultInitialState, useResultStore } from './resultStore';

const document: ResultDocument = {
  result: {
    id: 'result-1',
    workspaceId: 'workspace-1',
    type: 'document',
    title: '记录',
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
  content: '# 记录\n',
  contentHash: 'a'.repeat(64),
  sizeBytes: 9,
  editable: true,
  appliedReview: null,
};

const revision: ResultRevisionSummary = {
  id: 'revision-1',
  contentHash: document.contentHash,
  source: 'initial',
  summary: '创建成果',
  createdAt: document.result.createdAt,
  isCurrent: true,
};

describe('resultStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useResultStore.setState(resultInitialState);
    vi.spyOn(resultController, 'list').mockResolvedValue([document.result]);
  });

  it('creates and opens a Result without chat state', async () => {
    vi.spyOn(resultController, 'create').mockResolvedValue(document);
    await act(() =>
      useResultStore.getState().createTextResult({
        title: '记录',
        fileName: '记录.md',
        format: 'markdown',
      })
    );
    expect(useResultStore.getState().activeDocument).toEqual(document);
    expect(useResultStore.getState().draftContent).toBe(document.content);
    expect(useResultStore.getState().saveStatus).toBe('saved');
  });

  it('tracks dirty content, saves with the loaded hash, and exposes history', async () => {
    useResultStore.setState({ activeDocument: document, draftContent: document.content });
    const saved = {
      ...document,
      content: '# 记录\n\n已修改',
      contentHash: 'b'.repeat(64),
    };
    const save = vi.spyOn(resultController, 'save').mockResolvedValue(saved);
    vi.spyOn(resultController, 'listRevisions').mockResolvedValue([revision]);
    act(() => useResultStore.getState().updateDraft(saved.content));
    expect(useResultStore.getState().saveStatus).toBe('dirty');
    await act(() => useResultStore.getState().save());
    expect(save).toHaveBeenCalledWith('result-1', saved.content, document.contentHash);
    expect(useResultStore.getState().saveStatus).toBe('saved');
    await act(() => useResultStore.getState().loadRevisions());
    expect(useResultStore.getState().revisions).toEqual([revision]);
  });

  it('keeps the loaded document when Desktop reports a hash conflict', async () => {
    useResultStore.setState({
      activeDocument: document,
      draftContent: '冲突内容',
      saveStatus: 'dirty',
    });
    vi.spyOn(resultController, 'save').mockRejectedValue({
      code: 'FILE_CONFLICT',
      message: '文件已在外部发生变化',
    });
    await act(() => useResultStore.getState().save());
    expect(useResultStore.getState().activeDocument).toEqual(document);
    expect(useResultStore.getState().draftContent).toBe('冲突内容');
    expect(useResultStore.getState().saveStatus).toBe('conflict');
  });
});
