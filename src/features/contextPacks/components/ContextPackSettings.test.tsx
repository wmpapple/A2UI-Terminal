import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { DocumentSource } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { useImportStore } from '../../imports/importStore';
import { knowledgeController } from '../../knowledge/knowledgeController';
import { useContextPackStore } from '../contextPackStore';
import { ContextPackSettings } from './ContextPackSettings';

vi.mock('../../knowledge/KnowledgePicker', () => ({ KnowledgePicker: () => null }));

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
  const disclosure = screen.getByText('当前工作区资料 1 项');
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
