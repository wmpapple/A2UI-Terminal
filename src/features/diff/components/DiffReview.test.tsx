import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { createMockDiff, mockFiles } from '../../../shared/mock/workspace';
import { useAppStore } from '../../../stores/useAppStore';
import { DiffReview } from './DiffReview';

const originalApplyDiff = useAppStore.getState().applyDiff;

beforeEach(() => {
  useAppStore.setState({
    runtimeMode: 'web-mock',
    files: mockFiles,
    pendingDiff: createMockDiff(mockFiles[0]),
    patchApplying: false,
    patchError: null,
    applyDiff: originalApplyDiff,
  });
});

describe('DiffReview', () => {
  it('saves choices without removing review or changing the document', async () => {
    const before = useAppStore.getState().files;
    render(
      <I18nProvider>
        <DiffReview />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: '保存选择（不应用）' }));
    await waitFor(() => expect(screen.getByText(/选择已保存，可以关闭应用/)).toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'README.md' })).toBeChecked();
    expect(useAppStore.getState().files).toBe(before);
    expect(useAppStore.getState().pendingDiff).not.toBeNull();
  });

  it('does not select a restored rejected block by default', () => {
    const proposal = createMockDiff(mockFiles[0]);
    useAppStore.setState({
      pendingDiff: {
        ...proposal,
        status: 'partially_accepted',
        blocks: [{ ...proposal.blocks[0], status: 'rejected', selected: undefined }],
      },
    });
    render(
      <I18nProvider>
        <DiffReview />
      </I18nProvider>
    );
    expect(screen.getByRole('checkbox', { name: 'README.md' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /应用已选修改/ })).toBeDisabled();
  });
  it('renders only validated semantic blocks with before and after content', () => {
    render(
      <I18nProvider>
        <DiffReview />
      </I18nProvider>
    );

    expect(screen.getByText('已通过 Rust 校验')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('修改前')).toBeInTheDocument();
    expect(screen.getByText('修改后')).toBeInTheDocument();
  });

  it('explains that an A2UI action cannot write before review acceptance', () => {
    const proposal = createMockDiff(mockFiles[0]);
    useAppStore.setState({ pendingDiff: { ...proposal, source: 'a2ui_action' } });

    render(
      <I18nProvider>
        <DiffReview />
      </I18nProvider>
    );

    expect(screen.getByText('交互界面请求修改内容')).toBeInTheDocument();
    expect(screen.getByText(/点击接受前，文件和成果都不会发生变化/)).toBeInTheDocument();
  });

  it('allows a block to be rejected before applying', () => {
    render(
      <I18nProvider>
        <DiffReview />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'README.md' }));
    expect(screen.getByRole('button', { name: /应用已选修改/ })).toBeDisabled();
    expect(useAppStore.getState().pendingDiff?.blocks[0].selected).toBe(false);
  });

  it('explains how to generate a create review when no proposal exists', () => {
    useAppStore.setState({ pendingDiff: null });

    render(
      <I18nProvider>
        <DiffReview />
      </I18nProvider>
    );

    expect(screen.getByText('暂无待审阅方案')).toBeInTheDocument();
    expect(screen.getByText(/右侧 AI 助手中新建对话/)).toBeInTheDocument();
  });

  it('shows a visible editable file-name field for a create review', () => {
    const proposal = createMockDiff(mockFiles[0]);
    useAppStore.setState({
      pendingDiff: {
        ...proposal,
        blocks: [
          {
            ...proposal.blocks[0],
            kind: 'create_file',
            suggestedFileName: '杭州三日游.md',
            decidedFileName: null,
          },
        ],
      },
    });

    render(
      <I18nProvider>
        <DiffReview />
      </I18nProvider>
    );

    expect(screen.getByText('确认创建后的文件名')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '确认创建后的文件名' })).toHaveValue(
      '杭州三日游.md'
    );
    expect(screen.getByText(/只允许安全的/)).toBeInTheDocument();
  });

  it('opens a newly accepted managed result immediately', async () => {
    const proposal = createMockDiff(mockFiles[0]);
    const onOpenResult = vi.fn();
    useAppStore.setState({
      pendingDiff: proposal,
      applyDiff: vi.fn(async () => {
        useAppStore.setState({
          lastReviewApplication: {
            reviewId: proposal.id,
            status: 'applied',
            operationId: 'operation',
            files: [],
            result: {
              result: {
                id: 'result-created',
                workspaceId: 'managed-results',
                type: 'document',
                title: '杭州三日游',
                status: 'draft',
                storageKind: 'managed_local',
                currentRevisionId: 'revision',
                a2uiSurfaceId: null,
                createdAt: 'now',
                updatedAt: 'now',
                completedAt: null,
                storageRef: 'result://file/result-created',
                activeSessionId: null,
                managedState: { format: 'markdown' },
              },
              format: 'markdown',
              content: '# 杭州三日游',
              contentHash: 'a'.repeat(64),
              sizeBytes: 20,
              editable: true,
              appliedReview: {
                reviewId: proposal.id,
                workspaceId: proposal.workspaceId,
              },
              recoveryDraft: null,
            },
          },
        });
      }),
    });

    render(
      <I18nProvider>
        <DiffReview onOpenResult={onOpenResult} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /应用已选修改/ }));

    await waitFor(() => expect(onOpenResult).toHaveBeenCalledWith('result-created'));
  });

  it('shows three understandable choices when a persisted review conflicts', () => {
    const proposal = createMockDiff(mockFiles[0]);
    useAppStore.setState({
      pendingDiff: { ...proposal, status: 'conflicted', errorCode: 'FILE_CONFLICT' },
      patchError: '文件已在外部发生变化',
    });

    render(
      <I18nProvider>
        <DiffReview />
      </I18nProvider>
    );

    expect(screen.getByRole('button', { name: '保留当前版本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '另存候选副本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '基于当前版本重新生成' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /应用已选修改/ })).not.toBeInTheDocument();
  });
});
