import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { DocumentSource } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { useImportStore } from '../../imports/importStore';
import { knowledgeController } from '../../knowledge/knowledgeController';
import { useContextPackStore } from '../contextPackStore';
import { ContextPackSettings } from './ContextPackSettings';

it('keeps workspace authorization separate from library deletion', async () => {
  const source: DocumentSource = {
    id: 'source-1',
    workspaceId: 'workspace-1',
    name: 'paper.pdf',
    extension: 'pdf',
    kind: 'text',
    capability: 'read_only_text',
    mimeType: 'application/pdf',
    sizeBytes: 100,
    contentHash: 'hash',
    editable: false,
    warnings: [],
    table: null,
    image: null,
  };
  const revokeSource = vi.fn().mockResolvedValue(true);
  const forgetAuthorizedSource = vi.fn();
  const deleteKnowledge = vi.spyOn(knowledgeController, 'delete');
  useAppStore.setState({
    workspace: { id: 'workspace-1', name: 'Project', kind: 'directory', available: true },
    forgetAuthorizedSource,
  });
  useImportStore.setState({
    sources: [source],
    loadSources: vi.fn().mockResolvedValue(undefined),
    revokeSource,
  });
  useContextPackStore.setState({
    packs: [],
    load: vi.fn().mockResolvedValue(undefined),
  });
  render(
    <I18nProvider>
      <ContextPackSettings />
    </I18nProvider>
  );
  const disclosure = screen.getByText('当前工作区资料（1）');
  expect(disclosure.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(disclosure);
  fireEvent.click(screen.getByRole('button', { name: '资料操作：paper.pdf' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '从当前工作区移除' }));
  expect(revokeSource).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '从工作区移除' }));
  await waitFor(() => expect(revokeSource).toHaveBeenCalledWith('workspace-1', 'source-1'));
  expect(forgetAuthorizedSource).toHaveBeenCalledWith('source-1');
  expect(deleteKnowledge).not.toHaveBeenCalled();
  deleteKnowledge.mockRestore();
});

it('shows pack cards before opening the creation drawer', async () => {
  useAppStore.setState({
    workspace: { id: 'workspace-1', name: 'Project', kind: 'directory', available: true },
  });
  useImportStore.setState({ sources: [], loadSources: vi.fn().mockResolvedValue(undefined) });
  useContextPackStore.setState({
    packs: [{
      id: 'pack-1', workspaceId: 'workspace-1', name: 'NLP notes',
      items: [{ sourceId: 'source-1', label: 'paper.pdf', personalKnowledge: true }],
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    }],
    load: vi.fn().mockResolvedValue(undefined),
  });
  render(<I18nProvider><ContextPackSettings /></I18nProvider>);
  expect(screen.getByTestId('context-pack-item')).toHaveTextContent('NLP notes');
  expect(screen.queryByTestId('context-pack-name')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '打开' }));
  expect(screen.getByTestId('context-pack-item')).toHaveTextContent('个人资料');
  fireEvent.click(screen.getByRole('button', { name: '新建资料包' }));
  expect(within(screen.getByRole('dialog', { name: '新建资料包' })).getByTestId('context-pack-name')).toBeVisible();
});

it('uses a source count instead of a filename for a standalone workspace', () => {
  useAppStore.setState({
    workspace: { id: 'workspace-file', name: 'result.pdf', kind: 'standalone', available: true },
  });
  useImportStore.setState({
    sources: [{
      id: 'source-1', workspaceId: 'workspace-file', name: 'result.pdf', extension: 'pdf',
      kind: 'text', capability: 'read_only_text', mimeType: 'application/pdf', sizeBytes: 100,
      contentHash: 'hash', editable: false, warnings: [], table: null, image: null,
    }],
    loadSources: vi.fn().mockResolvedValue(undefined),
  });
  useContextPackStore.setState({ packs: [], load: vi.fn().mockResolvedValue(undefined) });
  render(<I18nProvider><ContextPackSettings /></I18nProvider>);
  expect(screen.getByText('当前工作区资料：1 项')).toBeVisible();
  expect(screen.getByText('当前工作区资料（1）')).toBeVisible();
  expect(screen.queryByText('来源文件：result.pdf')).not.toBeInTheDocument();
  expect(screen.queryByText('当前工作区：result.pdf')).not.toBeInTheDocument();
});
