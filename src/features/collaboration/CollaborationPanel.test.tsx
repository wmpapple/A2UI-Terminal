import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Modal } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import type { CollaborationOverview, InboxDetail } from '../../shared/types/collaboration';
import type { DocumentSnapshot } from '../../shared/types/document';
import type { ReviewRequest } from '../../shared/types/domain';
import { reviewController } from '../diff/reviewController';
import { useResultStore, resultInitialState } from '../results/resultStore';
import { collaborationController as api } from './collaborationController';
import { CollaborationPanel } from './CollaborationPanel';

const snapshot: DocumentSnapshot = {
  target: { kind: 'result', resultId: 'r' },
  revisionId: 'v',
  contentHash: 'h',
  format: 'markdown',
  text: '原文',
  editable: true,
  hasUnsavedDraft: false,
};
const overview: CollaborationOverview = {
  identity: { id: 'i', displayName: '小林' },
  pendingCount: 1,
  shares: [],
  inbox: [{ id: 'p', title: '报告', kind: 'share', status: 'received', createdAt: '2026-09-30' }],
};
const share: InboxDetail = {
  package: {
    kind: 'share',
    payload: {
      schemaVersion: 1,
      id: 'p',
      title: '报告',
      senderName: '作者',
      format: 'markdown',
      permission: 'review',
      content: '<img src="https://untrusted.invalid/tracker">',
      contentHash: 'h',
    },
  },
  reply: null,
};
const feedback: InboxDetail = {
  package: {
    kind: 'feedback',
    payload: {
      schemaVersion: 1,
      id: 'f',
      shareId: 'p',
      baseHash: 'h',
      reviewerName: '审阅者',
      comments: '请保留数字',
      proposedContent: '预算 420 元',
    },
  },
  reply: null,
};
const review = {
  id: 'review',
  workspaceId: 'w',
  resultId: 'r',
  status: 'pending',
  blocks: [{ id: 'b', targetLabel: '预算报告', before: '原文', after: '预算 420 元' }],
} as ReviewRequest;
const tree = (s?: DocumentSnapshot) => (
  <I18nProvider>
    <CollaborationPanel snapshot={s} />
  </I18nProvider>
);

describe('local collaboration', () => {
  beforeEach(() => {
    localStorage.clear();
    useResultStore.setState(resultInitialState);
    vi.spyOn(api, 'overview').mockResolvedValue(overview);
    vi.spyOn(api, 'inbox').mockResolvedValue(share);
    vi.spyOn(api, 'propose').mockResolvedValue(review);
    vi.spyOn(useResultStore.getState(), 'loadResults').mockResolvedValue();
    vi.spyOn(reviewController, 'decide').mockResolvedValue({ ...review, status: 'accepted' });
    vi.spyOn(reviewController, 'apply').mockResolvedValue({
      reviewId: 'review',
      status: 'applied',
      operationId: null,
      result: null,
      files: [],
    });
  });
  afterEach(() => {
    Modal.destroyAll();
    vi.restoreAllMocks();
  });
  async function open() {
    fireEvent.click(screen.getByRole('button', { name: /协作收件箱|协作审阅/ }));
    await screen.findByDisplayValue('小林');
  }
  async function select() {
    fireEvent.click(screen.getByRole('button', { name: /^查\s*看$/ }));
    await screen.findByText(/分享者（未验证）|审阅者（未验证）/);
    await waitFor(() => expect(screen.getByRole('button', { name: /^查\s*看$/ })).toBeEnabled());
  }
  it('disables sharing while the document is unsaved', async () => {
    render(tree({ ...snapshot, hasUnsavedDraft: true }));
    await open();
    expect(screen.getByRole('button', { name: '创建并导出分享包' })).toBeDisabled();
  });
  it('renders incoming text inertly and protects unsaved review comments on close', async () => {
    render(tree());
    await open();
    await select();
    expect(document.querySelector('img')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '审阅意见' }), {
      target: { value: '我的意见' },
    });
    const drawer = screen.getByRole('dialog', { name: '本地协作' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect((await screen.findAllByText('意见尚未保存，放弃更改？')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '审阅意见' })).toHaveValue('我的意见');
  });
  it('only applies a received proposal after explicit acceptance', async () => {
    vi.mocked(api.inbox).mockResolvedValue(feedback);
    render(tree());
    await open();
    await select();
    expect(reviewController.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '审阅建议修改' }));
    const dialog = (await screen.findByText('确认协作修改')).closest(
      '[role="dialog"]'
    ) as HTMLElement;
    expect(within(dialog).getByText('原文')).toBeInTheDocument();
    expect(within(dialog).getByText('目标成果：预算报告')).toBeInTheDocument();
    expect(reviewController.apply).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '接受并修改正文' }));
    await waitFor(() => expect(reviewController.apply).toHaveBeenCalledWith('review', 'w'));
    expect(await screen.findByRole('button', { name: '撤销刚才的协作修改' })).toBeEnabled();
  });
  it('read-only packages do not offer a feedback editor', async () => {
    if (share.package.kind !== 'share') throw new Error();
    vi.mocked(api.inbox).mockResolvedValue({
      package: { kind: 'share', payload: { ...share.package.payload, permission: 'read' } },
      reply: null,
    });
    render(tree());
    await open();
    await select();
    expect(screen.getByText('此分享仅供阅读。')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: '审阅意见' })).not.toBeInTheDocument();
  });
  it('retains proposal and surfaces failure when the owner document is stale', async () => {
    vi.mocked(api.inbox).mockResolvedValue(feedback);
    vi.mocked(reviewController.apply).mockRejectedValue({
      code: 'FILE_CONFLICT',
      message: 'file changed outside A2UI Workbench',
    });
    render(tree());
    await open();
    await select();
    fireEvent.click(screen.getByRole('button', { name: '审阅建议修改' }));
    const dialog = (await screen.findByText('确认协作修改')).closest(
      '[role="dialog"]'
    ) as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: '接受并修改正文' }));
    expect(
      await within(dialog).findByText(/原成果已更新时，请重新分享当前成果并收集意见/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销刚才的协作修改' })).not.toBeInTheDocument();
  });
});
