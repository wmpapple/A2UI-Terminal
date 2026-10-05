import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { CollaborationOverview, InboxDetail } from '../../../shared/types/collaboration';
import type { ResultSummary } from '../../../shared/types/domain';
import { collaborationController as api } from '../../collaboration/collaborationController';
import { resultInitialState, useResultStore } from '../resultStore';
import { ResultsPage } from './ResultsPage';

vi.mock('../../../shared/platform/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/platform/runtime')>()),
  isWebMock: () => false,
}));

const result: ResultSummary = {
  id: 'mine',
  workspaceId: 'workspace',
  type: 'document',
  title: '我的报告',
  status: 'ready',
  storageKind: 'managed_local',
  currentRevisionId: 'rev',
  a2uiSurfaceId: null,
  createdAt: '2026-10-05 09:00:00',
  updatedAt: '2026-10-05 09:00:00',
  completedAt: null,
};
const overview: CollaborationOverview = {
  identity: { id: 'me', displayName: '本机用户' },
  pendingCount: 2,
  shares: [],
  inbox: [
    {
      id: 'share',
      title: '产品方案',
      kind: 'share',
      status: 'received',
      createdAt: '2026-10-05 14:20:00',
      senderName: 'Alice',
      permission: 'review',
    },
    {
      id: 'read',
      title: '参考文档',
      kind: 'share',
      status: 'received',
      createdAt: '2026-10-05 13:00:00',
      senderName: 'Bob',
      permission: 'read',
    },
    {
      id: 'applied',
      title: '审阅意见',
      kind: 'feedback',
      status: 'applied',
      createdAt: '2026-10-04 10:00:00',
      senderName: 'Chris',
    },
    {
      id: 'replied',
      title: '季度报告',
      kind: 'share',
      status: 'replied',
      createdAt: '2026-10-03 10:00:00',
      senderName: 'Dana',
      permission: 'review',
    },
  ],
};
const detail: InboxDetail = {
  package: {
    kind: 'share',
    payload: {
      schemaVersion: 1,
      id: 'share',
      senderName: 'Alice',
      title: '产品方案',
      format: 'markdown',
      permission: 'review',
      content: '正文',
      contentHash: 'hash',
    },
  },
  reply: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  useResultStore.setState(resultInitialState);
});

it('keeps received shares in the inbox and follows real processing states', async () => {
  vi.spyOn(api, 'overview').mockResolvedValue(overview);
  vi.spyOn(api, 'inbox').mockResolvedValue(detail);
  useResultStore.setState({
    ...resultInitialState,
    results: [result],
    loadResults: vi.fn().mockResolvedValue(undefined),
  });
  render(
    <I18nProvider>
      <ResultsPage onOpenResult={vi.fn()} />
    </I18nProvider>
  );

  expect(screen.getByText('我的报告')).toBeVisible();
  await waitFor(() => expect(screen.getByRole('tab', { name: /协作收件箱.*2/ })).toBeVisible());
  fireEvent.click(screen.getByRole('tab', { name: /协作收件箱.*2/ }));
  expect(screen.queryByRole('button', { name: '新建成果' })).not.toBeInTheDocument();
  expect(screen.queryByText('我的报告')).not.toBeInTheDocument();
  expect(await screen.findByText('产品方案')).toBeVisible();
  expect(screen.getByText('来自：Alice（未验证）')).toBeVisible();
  expect(screen.getByText('内容：请帮忙审阅')).toBeVisible();
  expect(screen.getByText('内容：仅供查看')).toBeVisible();

  const filters = screen.getByRole('tablist', { name: '协作状态' });
  fireEvent.click(within(filters).getByRole('tab', { name: /已应用/ }));
  expect(screen.getByText('审阅意见')).toBeVisible();
  expect(screen.queryByText('产品方案')).not.toBeInTheDocument();
  fireEvent.click(within(filters).getByRole('tab', { name: /已处理/ }));
  expect(screen.getByText('季度报告')).toBeVisible();
  fireEvent.click(within(filters).getByRole('tab', { name: /待处理/ }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索协作内容' }), {
    target: { value: 'Alice' },
  });
  expect(screen.getByText('产品方案')).toBeVisible();
  expect(screen.queryByText('参考文档')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^打\s*开$/ }));
  expect(await screen.findByText('分享者（未验证）：Alice')).toBeVisible();
  expect(useResultStore.getState().results).toEqual([result]);
});

it('marks a read-only share handled without creating a result', async () => {
  let current = overview;
  vi.spyOn(api, 'overview').mockImplementation(async () => current);
  vi.spyOn(api, 'markHandled').mockImplementation(async (id) => {
    current = {
      ...current,
      pendingCount: current.pendingCount - 1,
      inbox: current.inbox.map((item) => (item.id === id ? { ...item, status: 'handled' } : item)),
    };
  });
  useResultStore.setState({
    ...resultInitialState,
    results: [result],
    loadResults: vi.fn().mockResolvedValue(undefined),
  });
  render(
    <I18nProvider>
      <ResultsPage onOpenResult={vi.fn()} />
    </I18nProvider>
  );
  fireEvent.click(await screen.findByRole('tab', { name: /协作收件箱.*2/ }));
  const readOnlyItem = screen.getByText('参考文档').closest('article') as HTMLElement;
  fireEvent.click(within(readOnlyItem).getByRole('button', { name: '标记已处理' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /协作收件箱.*1/ })).toBeVisible());
  expect(api.markHandled).toHaveBeenCalledWith('read');
  expect(screen.queryByText('参考文档')).not.toBeInTheDocument();
  fireEvent.click(
    within(screen.getByRole('tablist', { name: '协作状态' })).getByRole('tab', { name: /已处理/ })
  );
  expect(screen.getByText('参考文档')).toBeVisible();
  expect(useResultStore.getState().results).toEqual([result]);
});

it('updates the pending badge as soon as feedback is saved in the detail drawer', async () => {
  let current = overview;
  let reply: InboxDetail['reply'] = null;
  vi.spyOn(api, 'overview').mockImplementation(async () => current);
  vi.spyOn(api, 'inbox').mockImplementation(async () => ({ ...detail, reply }));
  vi.spyOn(api, 'feedback').mockImplementation(async (input) => {
    reply = {
      schemaVersion: 1,
      id: 'reply',
      shareId: 'share',
      baseHash: 'hash',
      reviewerName: '本机用户',
      comments: input.comments,
      proposedContent: null,
    };
    current = {
      ...current,
      pendingCount: 1,
      inbox: current.inbox.map((item) =>
        item.id === 'share' ? { ...item, status: 'replied' } : item
      ),
    };
    return reply;
  });
  vi.spyOn(api, 'export').mockResolvedValue(false);
  useResultStore.setState({
    ...resultInitialState,
    results: [result],
    loadResults: vi.fn().mockResolvedValue(undefined),
  });
  render(
    <I18nProvider>
      <ResultsPage onOpenResult={vi.fn()} />
    </I18nProvider>
  );
  fireEvent.click(await screen.findByRole('tab', { name: /协作收件箱.*2/ }));
  const shareItem = screen.getByText('产品方案').closest('article') as HTMLElement;
  fireEvent.click(within(shareItem).getByRole('button', { name: /^打\s*开$/ }));
  fireEvent.change(await screen.findByRole('textbox', { name: '审阅意见' }), {
    target: { value: '请调整摘要' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存并导出意见包' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /协作收件箱.*1/ })).toBeVisible());
  expect(api.feedback).toHaveBeenCalledWith({
    inboxId: 'share',
    comments: '请调整摘要',
    proposedContent: null,
  });
  expect(useResultStore.getState().results).toEqual([result]);
});
