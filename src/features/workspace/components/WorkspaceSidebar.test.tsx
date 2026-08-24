import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useAppStore } from '../../../stores/useAppStore';
import { WorkspaceSidebar } from './WorkspaceSidebar';

describe('WorkspaceSidebar', () => {
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
