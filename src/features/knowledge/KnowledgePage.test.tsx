import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import { KnowledgePage } from './KnowledgePage';
import { knowledgeController } from './knowledgeController';
import type { KnowledgeSource } from '../../shared/types/knowledge';
import { useAppStore } from '../../stores/useAppStore';
import { useImportStore } from '../imports/importStore';
import type { DocumentSource } from '../../shared/types/domain';

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
  expect(within(details).getByText('Library note')).toBeVisible();
  expect(within(details).getAllByText('已索引')).toHaveLength(2);
  expect(within(details).getByRole('region', { name: '基本信息' })).toHaveTextContent('note.md');
  expect(within(details).getByRole('region', { name: '状态信息' })).toHaveTextContent('索引状态');
  expect(within(details).getByRole('region', { name: '标签信息' })).toHaveTextContent('暂无标签');
  expect(within(details).getByRole('button', { name: '用于当前任务' })).toHaveClass('ant-btn-primary');
  fireEvent.click(within(details).getByRole('button', { name: /预\s*览/ }));
  await waitFor(() => expect(screen.getByText('Original immutable body')).toBeVisible());
  fireEvent.click(within(details).getByRole('button', { name: '添加标签' }));
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

it('opens local preview from the source menu', async () => {
  vi.mocked(knowledgeController.get).mockResolvedValue({
    source,
    parsed: { blocks: [{ id: 'b1', text: 'Local evidence', locator: { kind: 'unavailable' } }], warnings: [] },
  });
  render(<I18nProvider><KnowledgePage /></I18nProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '资料操作：Library note' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '预览' }));
  const details = await screen.findByRole('dialog', { name: '资料详情' });
  expect(within(details).getByText('Local evidence')).toBeVisible();
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

it('uses a scannable source list with file metadata', async () => {
  vi.mocked(knowledgeController.list).mockResolvedValue({
    items: [{ ...source, tags: ['NLP'] }],
    nextCursor: null,
  });
  render(
    <I18nProvider>
      <KnowledgePage />
    </I18nProvider>
  );
  await screen.findByRole('button', { name: 'Library note' });
  expect(screen.getByRole('button', { name: 'Library note' }).closest('li')).toHaveTextContent('Markdown');
  expect(screen.getByText('NLP')).toBeVisible();
  expect(screen.getByText('可检索')).toBeVisible();
  expect(screen.queryByRole('group', { name: '资料类型' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '资料操作：Library note' })).toBeVisible();
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

it('keeps a single primary import action in the empty library state', async () => {
  vi.mocked(knowledgeController.list).mockResolvedValue({ items: [], nextCursor: null });
  render(
    <I18nProvider>
      <KnowledgePage />
    </I18nProvider>
  );
  expect(await screen.findByText('还没有资料')).toBeVisible();
  expect(screen.queryByRole('button', { name: '资料操作：Library note' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '导入资料' })).toHaveClass('ant-btn-primary');
  expect(screen.queryByRole('button', { name: '从这里导入资料' })).not.toBeInTheDocument();
});

it('shows type filters for ten sources and allows returning to the full list', async () => {
  vi.mocked(knowledgeController.list).mockResolvedValue({
    items: [
      source,
      ...Array.from({ length: 8 }, (_, index) => ({ ...source, id: `note-${index}`, title: `Note ${index}` })),
      { ...source, id: 'pdf-1', title: 'paper.pdf', format: 'pdf' },
    ],
    nextCursor: null,
  });
  render(<I18nProvider><KnowledgePage /></I18nProvider>);
  await screen.findByRole('button', { name: 'paper.pdf' });
  fireEvent.click(screen.getByRole('button', { name: 'PDF', pressed: false }));
  expect(screen.getByRole('button', { name: 'paper.pdf' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Library note' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '全部', pressed: false }));
  expect(screen.getByRole('button', { name: 'Library note' })).toBeVisible();
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
  expect(screen.queryByRole('dialog', { name: '资料详情' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^确认删除$|^Confirm delete$/ }));
  await waitFor(() => expect(knowledgeController.delete).toHaveBeenCalledWith('k1'));
  expect(await screen.findByText('Managed copy pending cleanup')).toBeVisible();
});

it('removes only a matching workspace authorization from the source menu', async () => {
  const authorized: DocumentSource = {
    id: 'authorized-1', workspaceId: 'workspace-1', name: 'note.md', extension: 'md',
    kind: 'text', capability: 'read_only_text', mimeType: 'text/markdown', sizeBytes: 100,
    contentHash: source.rawHash, editable: false, warnings: [], table: null, image: null,
  };
  const revokeSource = vi.fn().mockResolvedValue(true);
  const forgetAuthorizedSource = vi.fn();
  useAppStore.setState({
    workspace: { id: 'workspace-1', name: 'Project', kind: 'directory', available: true },
    forgetAuthorizedSource,
  });
  useImportStore.setState({
    sources: [authorized], error: null, loadSources: vi.fn().mockResolvedValue(undefined),
    revokeSource,
  });
  render(<I18nProvider><KnowledgePage /></I18nProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '资料操作：Library note' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '从当前工作区移除' }));
  const confirmation = await screen.findByRole('dialog', { name: /从当前工作区移除/ });
  await waitFor(() => expect(within(confirmation).getByText('只取消当前工作区的授权；个人资料库中的副本和原文件不会删除。')).toBeVisible());
  expect(knowledgeController.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '从工作区移除' }));
  await waitFor(() => expect(revokeSource).toHaveBeenCalledWith('workspace-1', 'authorized-1'));
  expect(forgetAuthorizedSource).toHaveBeenCalledWith('authorized-1');
  expect(screen.getByRole('button', { name: 'Library note' })).toBeVisible();
});

it('keeps destructive source actions behind the detail drawer menu and confirmation', async () => {
  vi.mocked(knowledgeController.get).mockResolvedValue({ source, parsed: { blocks: [], warnings: [] } });
  render(<I18nProvider><KnowledgePage /></I18nProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Library note' }));
  const details = await screen.findByRole('dialog', { name: '资料详情' });
  fireEvent.click(within(details).getByRole('button', { name: '更多资料操作' }));
  const rename = await within(details).findByRole('menuitem', { name: '重命名' });
  await waitFor(() => expect(rename).toBeVisible());
  const deleteAction = within(details).getByRole('menuitem', { name: '从资料库删除' });
  fireEvent.click(deleteAction);
  expect(knowledgeController.delete).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText('删除资料副本？')).toBeVisible());
  expect(screen.getByRole('button', { name: '确认删除' })).toBeVisible();
});
