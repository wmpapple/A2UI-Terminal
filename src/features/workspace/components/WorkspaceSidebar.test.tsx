import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useAppStore } from '../../../stores/useAppStore';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { ImportBatchModal } from '../../imports/components/ImportBatchModal';
import { importController } from '../../imports/importController';
import { useImportStore } from '../../imports/importStore';
import type { ImportBatch } from '../../../shared/types/domain';
import importFixture from '../../../../contracts/v2/import.json';

describe('WorkspaceSidebar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useImportStore.setState({ batch: null, acceptedItemIds: [], loading: false, error: null });
  });

  it.each([false, true])(
    'explains rejected files before authorizing a batch (mixed: %s)',
    async (mixed) => {
      const batch: ImportBatch = {
        ...(importFixture as ImportBatch),
        items: [
          {
            id: 'blocked',
            name: 'credentials.json',
            extension: 'json',
            sizeBytes: 0,
            capability: 'unsupported',
            status: 'rejected',
            readable: false,
            editable: false,
            reasonCode: 'SENSITIVE_PATH',
            reason: '隐藏文件、密钥或敏感路径不会加入导入批次',
            alternative: '请改用不包含密钥的脱敏副本',
            warnings: [],
          },
          ...(mixed ? [(importFixture as ImportBatch).items[0]] : []),
        ],
        canConfirm: mixed,
      };
      const select = vi.spyOn(importController, 'select').mockResolvedValue(batch);
      const confirm = vi.spyOn(importController, 'confirm').mockResolvedValue({
        batch,
        workspace: null,
        documents: [],
        sources: [],
      });
      useImportStore.setState({ batch: null, acceptedItemIds: [], loading: false, error: null });
      useAppStore.setState({
        workspace: { id: 'workspace-1', name: 'docs', available: true, kind: 'directory' },
      });
      render(
        <I18nProvider>
          <WorkspaceSidebar />
          <ImportBatchModal onConfirmed={vi.fn()} />
        </I18nProvider>
      );
      fireEvent.click(screen.getByRole('button', { name: /添加文件/ }));
      await waitFor(() =>
        expect(screen.getByText('隐藏文件、密钥或敏感路径不会加入导入批次')).toBeVisible()
      );
      expect(screen.getByText(/请改用不包含密钥的脱敏副本/)).toBeVisible();
      expect(screen.getByRole('checkbox', { name: /credentials.json/ })).toBeDisabled();
      expect(select).toHaveBeenCalledWith('workspace-1');
      expect(confirm).not.toHaveBeenCalled();
      const button = screen.getByRole('button', { name: '确认加入资料' });
      if (mixed) {
        fireEvent.click(button);
        await waitFor(() => expect(confirm).toHaveBeenCalledWith(batch.id, [batch.items[1].id]));
      } else {
        expect(button).toBeDisabled();
      }
    }
  );

  it('renders the mock project files and disclosure', () => {
    render(
      <I18nProvider>
        <WorkspaceSidebar />
      </I18nProvider>
    );
    expect(screen.getByRole('treeitem', { name: /README\.md/i })).toBeInTheDocument();
    expect(screen.getByText(/不会读取或写入本地文件/)).toBeInTheDocument();
  });

  it('returns to the workspace editor when a source file is selected', () => {
    const onActivateWorkspace = vi.fn();
    render(
      <I18nProvider>
        <WorkspaceSidebar onActivateWorkspace={onActivateWorkspace} />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('treeitem', { name: /README\.md/i }));
    expect(onActivateWorkspace).toHaveBeenCalledOnce();
  });

  it('shows a full-width workspace removal action in desktop mode', () => {
    useAppStore.setState({
      runtimeMode: 'desktop',
      workspace: { id: 'workspace-1', name: 'docs', available: true, kind: 'directory' },
      recentWorkspaces: [{ id: 'workspace-1', name: 'docs', available: true, kind: 'directory' }],
      workspaceEntries: [],
      files: [],
      openPaths: [],
      activePath: '',
      recoveryDraftSummaries: [],
    });

    render(
      <I18nProvider>
        <WorkspaceSidebar />
      </I18nProvider>
    );

    expect(screen.getByRole('button', { name: '删除工作区记录' })).toBeVisible();
  });

  it('surfaces crash drafts before their files are opened', () => {
    useAppStore.setState({
      runtimeMode: 'desktop',
      workspace: { id: 'workspace-1', name: 'docs', available: true, kind: 'directory' },
      recentWorkspaces: [],
      workspaceEntries: [
        {
          path: 'notes.md',
          name: 'notes.md',
          language: 'markdown',
          sizeBytes: 10,
          readable: true,
          editable: true,
          extracted: false,
        },
      ],
      recoveryDraftSummaries: [
        {
          relativePath: 'notes.md',
          baseHash: 'base',
          currentHash: 'current',
          updatedAt: '2026-08-11 10:00:00',
          conflict: true,
          available: true,
        },
      ],
    });

    render(
      <I18nProvider>
        <WorkspaceSidebar />
      </I18nProvider>
    );

    expect(screen.getByText('发现 1 个崩溃恢复草稿')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'notes.md' })).not.toHaveLength(0);
  });
});
