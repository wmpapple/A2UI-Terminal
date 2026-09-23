import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import { KnowledgePage } from './KnowledgePage';
import { knowledgeController } from './knowledgeController';
import type { KnowledgeSource } from '../../shared/types/knowledge';

vi.mock('./knowledgeController', () => ({
  knowledgeController: {
    list: vi.fn(),
    get: vi.fn(),
    edit: vi.fn(),
    delete: vi.fn(),
    confirm: vi.fn(),
  },
}));
vi.mock('../imports/useImportDropTarget', () => ({
  useImportDropTarget: () => ({ current: null }),
}));
vi.mock('../../shared/platform/runtime', () => ({ isWebMock: () => false }));
vi.mock('../contextPacks/components/ContextPackSettings', () => ({
  ContextPackSettings: () => null,
}));
const source: KnowledgeSource = {
  id: 'k1',
  title: 'Library note',
  format: 'md',
  originalName: 'note.md',
  rawHash: 'hash',
  extractedHash: 'text',
  parserVersion: 'v1',
  sourceVersion: 1,
  tags: [],
  status: 'ready',
  createdAt: 'today',
  updatedAt: 'today',
};

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '';
  localStorage.clear();
  vi.mocked(knowledgeController.list).mockResolvedValue({ items: [source], nextCursor: null });
});

it('previews trusted extracted text and saves title and tags without editing the source body', async () => {
  vi.mocked(knowledgeController.get).mockResolvedValue({
    source,
    parsed: {
      blocks: [{ id: 'b1', text: 'Original immutable body', locator: { kind: 'unavailable' } }],
      warnings: [],
    },
  });
  vi.mocked(knowledgeController.edit).mockResolvedValue({ ...source, title: 'Updated title' });
  render(
    <I18nProvider>
      <KnowledgePage />
    </I18nProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Library note' }));
  await waitFor(() => expect(screen.getByText('Original immutable body')).toBeVisible());
  fireEvent.change(screen.getByRole('textbox', { name: /资料名称|Source title/ }), {
    target: { value: 'Updated title' },
  });
  fireEvent.click(screen.getByRole('button', { name: /保存名称和标签|Save title and tags/ }));
  await waitFor(() =>
    expect(knowledgeController.edit).toHaveBeenCalledWith({
      id: 'k1',
      title: 'Updated title',
      tags: [],
    })
  );
});

it('keeps the current page when loading the next cursor', async () => {
  vi.mocked(knowledgeController.list)
    .mockResolvedValueOnce({ items: [source], nextCursor: 1 })
    .mockResolvedValueOnce({
      items: [{ ...source, id: 'k2', title: 'Second note' }],
      nextCursor: null,
    });
  render(
    <I18nProvider>
      <KnowledgePage />
    </I18nProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: /加载更多|Load more/ }));
  expect(await screen.findByRole('button', { name: 'Second note' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Library note' })).toBeVisible();
  expect(knowledgeController.list).toHaveBeenCalledTimes(2);
});

it('requires deletion confirmation and exposes cleanup failure instead of claiming success', async () => {
  vi.mocked(knowledgeController.delete).mockRejectedValue(
    new Error('Managed copy pending cleanup')
  );
  render(
    <I18nProvider>
      <KnowledgePage />
    </I18nProvider>
  );
  await screen.findByRole('button', { name: 'Library note' });
  fireEvent.click(screen.getByRole('button', { name: /^删\s*除$|^Delete$/ }));
  expect(knowledgeController.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^确认删除$|^Confirm delete$/ }));
  await waitFor(() => expect(knowledgeController.delete).toHaveBeenCalledWith('k1'));
  expect(await screen.findByText('Managed copy pending cleanup')).toBeVisible();
});
