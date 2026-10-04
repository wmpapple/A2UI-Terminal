import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import { KnowledgePage } from './KnowledgePage';
import { knowledgeController } from './knowledgeController';
import type { KnowledgeSource } from '../../shared/types/knowledge';
import { useAppStore } from '../../stores/useAppStore';

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
vi.mock('../../shared/platform/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/platform/runtime')>()),
  isWebMock: () => false,
}));
vi.mock('../contextPacks/components/ContextPackSettings', () => ({
  ContextPackSettings: () => null,
}));
vi.mock('../citation/LocatorUpgrade', () => ({ LocatorUpgrade: () => null }));
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
  const details = await screen.findByRole('dialog', { name: '资料详情' });
  expect(details).toBeVisible();
  fireEvent.click(within(details).getByRole('button', { name: /预\s*览/ }));
  await waitFor(() => expect(screen.getByText('Original immutable body')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '管理名称和标签' }));
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

it('prepares a personal source for the current task without sending it', async () => {
  vi.mocked(knowledgeController.get).mockResolvedValue({
    source,
    parsed: { blocks: [], warnings: [] },
  });
  useAppStore.setState({
    workspace: { id: 'workspace-test', name: 'Project', kind: 'directory', available: true },
    activeSessionId: 'welcome',
    contextBySession: {},
    contextReviewKeyBySession: {},
  });
  render(
    <I18nProvider>
      <KnowledgePage />
    </I18nProvider>
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Library note' }));
  const details = await screen.findByRole('dialog', { name: '资料详情' });
  fireEvent.click(within(details).getByRole('button', { name: '用于当前任务' }));
  expect(useAppStore.getState().contextBySession.welcome.personalKnowledgeIds).toEqual(['k1']);
  expect(useAppStore.getState().contextReviewKeyBySession.welcome).toBe(
    'library-selection-needs-review'
  );
  expect(window.location.hash).toBe('#/workbench');
});

it('shows the same import action in the empty library state', async () => {
  vi.mocked(knowledgeController.list).mockResolvedValue({ items: [], nextCursor: null });
  render(
    <I18nProvider>
      <KnowledgePage />
    </I18nProvider>
  );
  expect(await screen.findByText('还没有资料')).toBeVisible();
  expect(screen.getAllByRole('button', { name: /导入资料/ })).toHaveLength(2);
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
  const actions = screen.getByRole('button', { name: '资料操作：Library note' });
  await waitFor(() => expect(actions).toBeEnabled());
  fireEvent.click(actions);
  fireEvent.click(await screen.findByRole('menuitem', { name: /从.*资料库.*删除/ }));
  expect(knowledgeController.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^确认删除$|^Confirm delete$/ }));
  await waitFor(() => expect(knowledgeController.delete).toHaveBeenCalledWith('k1'));
  expect(await screen.findByText('Managed copy pending cleanup')).toBeVisible();
});
