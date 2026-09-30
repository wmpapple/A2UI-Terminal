import { Alert, Button, Checkbox, Drawer, Empty, Input, Modal, Select, Space, Tag } from 'antd';
import { useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { InfoNotice } from '../../shared/components/InfoNotice';
import { userFacingError } from '../../shared/errors/userFacingError';
import { errorDetails } from '../../stores/support';
import type { DocumentSnapshot } from '../../shared/types/document';
import type {
  CollaborationOverview,
  InboxDetail,
  SharePermission,
} from '../../shared/types/collaboration';
import type { ReviewRequest } from '../../shared/types/domain';
import { useResultStore } from '../results/resultStore';
import { reviewController } from '../diff/reviewController';
import { collaborationController as api } from './collaborationController';
import styles from './CollaborationPanel.module.css';

export function CollaborationPanel({ snapshot }: { snapshot?: DocumentSnapshot }) {
  const { locale } = useI18n();
  const say = (cn: string, en: string) => (locale === 'zh-CN' ? cn : en);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [data, setData] = useState<CollaborationOverview | null>(null);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<SharePermission>('review');
  const [detail, setDetail] = useState<InboxDetail | null>(null);
  const [comments, setComments] = useState('');
  const [hasProposal, setHasProposal] = useState(false);
  const [draft, setDraft] = useState('');
  const [review, setReview] = useState<ReviewRequest | null>(null);
  const [undoable, setUndoable] = useState<ReviewRequest | null>(null);
  const resultId = snapshot?.target.kind === 'result' ? snapshot.target.resultId : undefined;
  const share = detail?.package.kind === 'share' ? detail.package.payload : null;
  const feedback = detail?.package.kind === 'feedback' ? detail.package.payload : null;
  const dirty =
    !!share &&
    (comments !== (detail?.reply?.comments ?? '') ||
      hasProposal !== (detail?.reply?.proposedContent != null) ||
      (hasProposal && draft !== (detail?.reply?.proposedContent ?? share.content)));

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(userFacingError(e, locale));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    const next = await api.overview(resultId);
    setData(next);
    setName(next.identity.displayName);
  }
  async function select(id: string) {
    const next = await api.inbox(id);
    setDetail(next);
    setComments(next.reply?.comments ?? '');
    setHasProposal(next.reply?.proposedContent != null);
    setDraft(
      next.reply?.proposedContent ??
        (next.package.kind === 'share' ? next.package.payload.content : '')
    );
  }
  function navigate(action: () => void) {
    if (busy) return;
    if (!dirty) {
      action();
      return;
    }
    Modal.confirm({
      title: say('意见尚未保存，放弃更改？', 'Discard unsaved feedback?'),
      okText: say('放弃更改', 'Discard'),
      cancelText: say('继续编辑', 'Keep editing'),
      onOk: action,
    });
  }
  function assertSaved(r: ReviewRequest) {
    const state = useResultStore.getState();
    if (
      state.activeDocument?.result.id === r.resultId &&
      (state.saveStatus !== 'saved' ||
        state.draftContent !== state.activeDocument.content ||
        state.activeDocument.recoveryDraft)
    )
      throw new Error(
        say(
          '请先保存或放弃成果中的未保存修改，再处理协作建议。',
          'Save or discard your document edits first.'
        )
      );
  }
  async function reloadResult(r: ReviewRequest) {
    const state = useResultStore.getState();
    if (state.activeDocument?.result.id === r.resultId && r.resultId)
      await state.openResult(r.resultId);
    await state.loadResults();
  }
  async function accept() {
    if (!review) return;
    assertSaved(review);
    await reviewController.decide(
      review.id,
      review.workspaceId,
      review.blocks.map((b) => ({ blockId: b.id, accepted: true }))
    );
    assertSaved(review);
    const applied = await withFreshShare(() =>
      reviewController.apply(review.id, review.workspaceId)
    );
    if (applied.status !== 'applied')
      throw new Error(
        say(
          '成果已变化，建议未应用。请重新分享当前成果。',
          'The result changed. Share a new snapshot before applying feedback.'
        )
      );
    setUndoable(review);
    setReview(null);
    await reloadResult(review);
    setNotice(say('修改已应用，可以撤销。', 'Changes applied. Undo is available.'));
  }
  async function withFreshShare<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (e) {
      if (errorDetails(e).code === 'FILE_CONFLICT') {
        throw new Error(
          say(
            '文档版本或编辑状态已变化，此次未修改正文。请先保存或放弃本机草稿；原成果已更新时，请重新分享当前成果并收集意见，旧建议不能通过重试应用。',
            'The result version or editing state changed. Nothing was applied. Save or discard local drafts. If the saved result changed, share a new snapshot and request fresh feedback; retrying the old proposal will not apply it.'
          )
        );
      }
      throw e;
    }
  }
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
          void run(refresh);
        }}
      >
        {snapshot ? say('协作审阅', 'Collaborate') : say('协作收件箱', 'Collaboration inbox')}
      </Button>
      <Drawer
        title={say('本地协作', 'Local collaboration')}
        open={open}
        size={680}
        onClose={() =>
          navigate(() => {
            setOpen(false);
            setDetail(null);
          })
        }
        maskClosable={!busy}
      >
        <div className={styles.panel} aria-busy={busy}>
          <InfoNotice
            showIcon
            title={say(
              '导出的是明文成果快照，请自行交给审阅者。姓名由对方填写，未经身份验证；撤销分享只能阻止本机继续导入或应用，不能收回已交出的文件。',
              'Packages contain a plain text snapshot. Deliver them yourself. Names are self-reported. Revoking blocks local use of feedback; it cannot recall delivered files.'
            )}
          />
          {error && (
            <Alert type="error" showIcon closable title={error} onClose={() => setError('')} />
          )}
          {notice && <p role="status">{notice}</p>}
          <label>
            {say('我的协作署名', 'My display name')}
            <Input
              value={name}
              maxLength={80}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <Space wrap>
            <Button
              disabled={busy || !name.trim() || name === data?.identity.displayName}
              onClick={() =>
                void run(async () => {
                  await api.rename(name);
                  await refresh();
                })
              }
            >
              {say('保存署名', 'Save name')}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                navigate(
                  () =>
                    void run(async () => {
                      const id = await api.import();
                      if (id) {
                        await refresh();
                        await select(id);
                      }
                    })
                )
              }
            >
              {say('导入协作包', 'Import package')}
            </Button>
          </Space>
          {snapshot && (
            <section>
              <h3>{say('分享当前成果', 'Share this result')}</h3>
              <p>
                {say(
                  '包含：已保存的标题和全文。不包含：资料附件、聊天记录或服务配置。',
                  'Includes the saved title and text. Attachments, chats and service settings are excluded.'
                )}
              </p>
              <Select
                aria-label={say('分享权限', 'Share permission')}
                value={permission}
                disabled={busy}
                onChange={setPermission}
                options={[
                  { value: 'review', label: say('允许返回审阅意见', 'Allow feedback') },
                  { value: 'read', label: say('仅阅读', 'Read only') },
                ]}
              />
              <Button
                disabled={
                  busy || !snapshot.editable || snapshot.hasUnsavedDraft || !snapshot.revisionId
                }
                onClick={() =>
                  void run(async () => {
                    if (!resultId || !snapshot.revisionId) return;
                    const p = await api.share({
                      resultId,
                      baseHash: snapshot.contentHash,
                      revisionId: snapshot.revisionId,
                      permission,
                    });
                    await refresh();
                    if (await api.export(p.id, false))
                      setNotice(
                        say(
                          '分享包已导出，请交给审阅者。',
                          'Share exported. Deliver it to the reviewer.'
                        )
                      );
                  })
                }
              >
                {say('创建并导出分享包', 'Create and export share')}
              </Button>
              {snapshot.hasUnsavedDraft && (
                <p>{say('请先保存成果，再分享。', 'Save the result before sharing.')}</p>
              )}
            </section>
          )}
          <section>
            <h3>{say('已创建的分享（最近 100 条）', 'Issued shares (latest 100)')}</h3>
            {data?.shares.map((item) => (
              <div key={item.id} className={styles.row}>
                <span>
                  {item.title} · {item.createdAt}{' '}
                  <Tag>
                    {item.status === 'active' ? say('有效', 'Active') : say('已撤销', 'Revoked')}
                  </Tag>
                </span>
                <Space>
                  <Button
                    disabled={busy || item.status !== 'active'}
                    onClick={() =>
                      void run(async () => {
                        if (await api.export(item.id, false))
                          setNotice(say('分享包已导出。', 'Share exported.'));
                      })
                    }
                  >
                    {say('导出', 'Export')}
                  </Button>
                  <Button
                    disabled={busy || item.status !== 'active'}
                    onClick={() =>
                      Modal.confirm({
                        title: say('撤销此分享？', 'Revoke this share?'),
                        content: say(
                          '此分享的返回意见和待接受修改将不能再应用。已导出的文件仍可被阅读。',
                          'Future feedback and pending changes will be blocked. Exported copies remain readable.'
                        ),
                        okText: say('撤销分享', 'Revoke'),
                        cancelText: say('取消', 'Cancel'),
                        onOk: () =>
                          run(async () => {
                            await api.revoke(item.id);
                            await refresh();
                          }),
                      })
                    }
                  >
                    {say('撤销分享', 'Revoke')}
                  </Button>
                </Space>
              </div>
            ))}
          </section>
          <section>
            <h3>{say('收到的分享与意见（最近 100 条）', 'Received packages (latest 100)')}</h3>
            {data && !data.inbox.length && (
              <Empty description={say('尚未导入协作包', 'No packages imported')} />
            )}
            {data?.inbox.map((item) => (
              <div key={item.id} className={styles.row}>
                <span>
                  {item.title} ·{' '}
                  {item.kind === 'share' ? say('分享', 'Share') : say('意见', 'Feedback')} ·{' '}
                  {item.createdAt}
                </span>
                <Button
                  disabled={busy}
                  onClick={() => navigate(() => void run(() => select(item.id)))}
                >
                  {say('查看', 'Open')}
                </Button>
              </div>
            ))}
          </section>
          {share && (
            <section key={share.id}>
              <h3>{share.title}</h3>
              <p>
                {say('分享者（未验证）：', 'Sender (unverified): ')}
                {share.senderName}
              </p>
              <pre className={styles.text}>{share.content}</pre>
              {share.permission === 'read' ? (
                <p>{say('此分享仅供阅读。', 'This share is read only.')}</p>
              ) : (
                <>
                  <label>
                    {say('审阅意见', 'Comments')}
                    <Input.TextArea
                      value={comments}
                      maxLength={8000}
                      rows={4}
                      disabled={busy}
                      onChange={(e) => setComments(e.target.value)}
                    />
                  </label>
                  <Checkbox
                    checked={hasProposal}
                    disabled={busy}
                    onChange={(e) => setHasProposal(e.target.checked)}
                  >
                    {say('附上建议修改稿（全文）', 'Include a proposed replacement (full text)')}
                  </Checkbox>
                  {hasProposal && (
                    <Input.TextArea
                      aria-label={say('建议修改稿', 'Proposed text')}
                      value={draft}
                      rows={12}
                      disabled={busy}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  )}
                  <Button
                    type="primary"
                    disabled={busy || (!comments.trim() && !hasProposal)}
                    onClick={() =>
                      void run(async () => {
                        await api.feedback({
                          inboxId: share.id,
                          comments,
                          proposedContent: hasProposal ? draft : null,
                        });
                        await select(share.id);
                        await refresh();
                        if (await api.export(share.id, true))
                          setNotice(
                            say(
                              '意见包已导出，请交回成果所有者。',
                              'Feedback exported. Return it to the owner.'
                            )
                          );
                        else
                          setNotice(
                            say(
                              '意见已保存在本机，导出已取消。',
                              'Feedback saved locally; export cancelled.'
                            )
                          );
                      })
                    }
                  >
                    {say('保存并导出意见包', 'Save and export feedback')}
                  </Button>
                </>
              )}
            </section>
          )}
          {feedback && (
            <section>
              <h3>{say('收到的审阅意见', 'Received feedback')}</h3>
              <p>
                {say('审阅者（未验证）：', 'Reviewer (unverified): ')}
                {feedback.reviewerName}
              </p>
              <pre className={styles.text}>{feedback.comments}</pre>
              {feedback.proposedContent !== null && (
                <>
                  <pre className={styles.text}>{feedback.proposedContent}</pre>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await withFreshShare(() => api.propose(feedback.id));
                        assertSaved(r);
                        setReview(r);
                      })
                    }
                  >
                    {say('审阅建议修改', 'Review proposed changes')}
                  </Button>
                </>
              )}
            </section>
          )}
          {undoable && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  assertSaved(undoable);
                  await reviewController.undoReview(undoable.id, undoable.workspaceId);
                  await reloadResult(undoable);
                  setUndoable(null);
                  setNotice(say('协作修改已撤销。', 'Collaboration changes undone.'));
                })
              }
            >
              {say('撤销刚才的协作修改', 'Undo collaboration changes')}
            </Button>
          )}
        </div>
      </Drawer>
      <Modal
        title={say('确认协作修改', 'Confirm collaboration changes')}
        open={!!review}
        width={960}
        onCancel={() => {
          if (!busy) setReview(null);
        }}
        footer={
          <Space>
            <Button
              disabled={busy}
              onClick={() => {
                if (review)
                  void run(async () => {
                    await reviewController.discard(review.workspaceId, review.id);
                    setReview(null);
                  });
              }}
            >
              {say('拒绝修改', 'Reject changes')}
            </Button>
            <Button
              type="primary"
              loading={busy}
              disabled={
                !review || !['pending', 'partially_accepted', 'accepted'].includes(review.status)
              }
              onClick={() => void run(accept)}
            >
              {say('接受并修改正文', 'Accept and apply')}
            </Button>
          </Space>
        }
      >
        {error && <Alert type="error" title={error} closable onClose={() => setError('')} />}
        {review && (
          <p>
            {say('目标成果：', 'Target result: ')}
            {review.blocks[0]?.targetLabel}
          </p>
        )}
        {review && !['pending', 'partially_accepted', 'accepted'].includes(review.status) && (
          <p>{say('此建议已处理，不能重复应用。', 'This proposal has already been handled.')}</p>
        )}
        {review?.blocks.map((block) => (
          <div key={block.id} className={styles.comparison}>
            <section>
              <h4>{say('修改前', 'Before')}</h4>
              <pre className={styles.text}>{block.before}</pre>
            </section>
            <section>
              <h4>{say('建议修改后', 'Proposed')}</h4>
              <pre className={styles.text}>{block.after}</pre>
            </section>
          </div>
        ))}
      </Modal>
    </>
  );
}
