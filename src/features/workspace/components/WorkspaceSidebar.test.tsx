import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

  it('shows a full-width workspace removal action in desktop mode', () => {
    useAppStore.setState({
      runtimeMode: 'desktop',
      workspace: { id: 'workspace-1', name: 'docs', available: true, kind: 'directory' },
      recentWorkspaces: [{ id: 'workspace-1', name: 'docs', available: true, kind: 'directory' }],
      workspaceEntries: [],
      files: [],
      openPaths: [],
      activePath: '',
    });

    render(
      <I18nProvider>
        <WorkspaceSidebar />
      </I18nProvider>
    );

    expect(screen.getByRole('button', { name: '删除工作区记录' })).toBeVisible();
  });
});
