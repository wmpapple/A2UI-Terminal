import { EllipsisOutlined, FileOutlined, LinkOutlined, WarningOutlined } from '@ant-design/icons';
import { Alert, Button, Collapse, Dropdown, Modal, Popconfirm, Space } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import type { SceneLinkView, ToolBinding } from '../../shared/types/sceneTool';
import { BindingPicker } from './BindingPicker';
import { BindingVersions } from './BindingVersions';
import { sceneToolController as api } from './sceneToolController';
import styles from './SceneTools.module.css';

export function ToolBindingPanel({
  toolResultId,
  toolStateHash,
  dirty,
  onOpenDocument,
  professional = false,
}: {
  toolResultId: string;
  toolStateHash: string;
  dirty: boolean;
  onOpenDocument: (id: string) => void;
  professional?: boolean;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [view, setView] = useState<SceneLinkView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ToolBinding>({ type: 'none' });
  const epoch = useRef(0);
  const loading = useRef(false);
  const active = useRef(true);
  const working = useRef(false);
  const refresh = useCallback(async () => {
    if (loading.current || working.current) return;
    loading.current = true;
    const ticket = ++epoch.current;
    try {
      const next = await api.readLink(toolResultId);
      if (active.current && epoch.current === ticket) {
        setView(next);
        setError('');
      }
    } catch (reason) {
      if (active.current && epoch.current === ticket)
        setError(
          reason && typeof reason === 'object' && 'message' in reason
            ? String(reason.message)
            : String(reason)
        );
    } finally {
      loading.current = false;
    }
  }, [toolResultId]);

  useEffect(() => {
    active.current = true;
    const initial = window.setTimeout(() => void refresh(), 0);
    const check = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(check, 5000);
    window.addEventListener('focus', check);
    return () => {
      active.current = false;
      clearTimeout(initial);
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [refresh, toolStateHash]);

  useEffect(() => {
    const openPicker = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== toolResultId || !view) return;
      setSelected(view.link?.binding ?? { type: 'none' });
      setSelecting(true);
    };
    window.addEventListener('scene-tool-change-binding', openPicker);
    return () => window.removeEventListener('scene-tool-change-binding', openPicker);
  }, [toolResultId, view]);

  const change = async (operation: () => Promise<SceneLinkView>) => {
    if (working.current) return;
    working.current = true;
    epoch.current++;
    setBusy(true);
    setError('');
    try {
      const next = await operation();
      window.dispatchEvent(new Event('scene-tool-list-changed'));
      if (active.current) {
        setView(next);
        setSelecting(false);
      }
    } catch (reason) {
      if (active.current)
        setError(
          reason && typeof reason === 'object' && 'message' in reason
            ? String(reason.message)
            : String(reason)
        );
    } finally {
      working.current = false;
      if (active.current) {
        setBusy(false);
        void refresh();
      }
    }
  };

  const safeStatus =
    (dirty || toolStateHash !== view?.toolStateHash) && view?.status === 'current'
      ? 'unchecked'
      : view?.status;
  const statusText = {
    unbound: zh ? '未关联对象' : 'No linked target',
    unchecked: zh ? '尚未核对' : 'Not reviewed',
    current: zh ? '关联正常' : 'Link current',
    changed: zh ? '关联对象自上次核对后已有修改' : 'Target changed since review',
    unavailable: zh ? '关联对象不可用' : 'Linked target unavailable',
    unsaved: zh ? '关联文档有未保存修改' : 'Linked document has unsaved changes',
  };
  const compactStatusText = {
    unchecked: zh ? '尚未核对' : 'Not reviewed',
    current: zh ? '正常' : 'Current',
    changed: zh ? '已更新' : 'Updated',
    unavailable: zh ? '已失效' : 'Unavailable',
    unsaved: zh ? '有未保存修改' : 'Has unsaved changes',
  };
  const warning = safeStatus && ['unavailable', 'unsaved'].includes(safeStatus);
  const canConfirm = Boolean(
    !dirty &&
    !busy &&
    !error &&
    view?.link &&
    view.currentHash &&
    !['unavailable', 'unsaved', 'unbound'].includes(view.status) &&
    toolStateHash === view.toolStateHash
  );
  const binding = view?.link?.binding;
  const openId =
    binding?.type === 'result'
      ? binding.targetId
      : binding?.type === 'document' && binding.target.kind === 'result'
        ? binding.target.resultId
        : null;

  const picker = () => {
    setSelected(view?.link?.binding ?? { type: 'none' });
    setSelecting(true);
  };

  return (
    <section
      className={styles.linkSummary}
      aria-label={zh ? '关联对象与核对' : 'Tool binding review'}
    >
      <div className={styles.linkSummaryRow}>
        <span className={styles.linkIdentity}>
          {safeStatus === 'changed' ? (
            <WarningOutlined />
          ) : view?.link ? (
            <FileOutlined />
          ) : (
            <LinkOutlined />
          )}
          <strong className={styles.bindingStatusText}>
            {view?.link
              ? `${view.link.targetTitle} · ${
                  safeStatus && safeStatus !== 'unbound'
                    ? safeStatus === 'changed'
                      ? zh
                        ? '已发生变化'
                        : 'Changed'
                      : compactStatusText[safeStatus]
                    : zh
                      ? '状态未知'
                      : 'Unknown'
                }`
              : zh
                ? '未关联对象 · 可独立使用'
                : 'No linked target · Standalone'}
          </strong>
        </span>
        <Space wrap>
          <Button disabled={busy || !view} onClick={picker}>
            {view?.link ? (zh ? '更换' : 'Change') : zh ? '关联对象' : 'Link target'}
          </Button>
          {openId && view?.status !== 'unavailable' ? (
            <Button disabled={busy} onClick={() => onOpenDocument(openId)}>
              {zh ? '查看对象' : 'View target'}
            </Button>
          ) : null}
          {safeStatus === 'changed' ? (
            <Popconfirm
              title={
                zh
                  ? '确认已对照当前对象版本重新核对本工具记录？'
                  : 'Confirm these entries were reviewed against the current target?'
              }
              onConfirm={() =>
                change(() =>
                  api.confirmLink({
                    toolResultId,
                    version: view!.link!.version,
                    targetHash: view!.currentHash!,
                    targetRevisionId: view!.currentRevisionId,
                    toolStateHash: view!.toolStateHash,
                  })
                )
              }
            >
              <Button disabled={!canConfirm} loading={busy}>
                {zh ? '重新核对' : 'Review again'}
              </Button>
            </Popconfirm>
          ) : null}
          {professional ? (
            <Dropdown
              menu={{
                items: [{ key: 'refresh', label: zh ? '刷新关联状态' : 'Refresh link status' }],
                onClick: () => void refresh(),
              }}
            >
              <Button
                type="text"
                icon={<EllipsisOutlined />}
                aria-label={zh ? '更多关联操作' : 'More link actions'}
              />
            </Dropdown>
          ) : null}
        </Space>
      </div>

      {error ? <Alert type="error" showIcon title={error} /> : null}
      {warning ? <Alert type="warning" showIcon title={statusText[safeStatus!]} /> : null}

      {view?.link ? (
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'details',
              label: zh ? '关联详情与核对依据' : 'Link details and evidence',
              children: (
                <div className={styles.linkDetails}>
                  <BindingVersions view={view} />
                  <p>
                    {zh ? '上次核对：' : 'Last reviewed: '}
                    {view.link.reviewedAt
                      ? new Date(view.link.reviewedAt).toLocaleString(locale)
                      : zh
                        ? '尚未核对'
                        : 'Not yet'}
                  </p>
                  <Popconfirm
                    title={
                      zh
                        ? '确认已对照当前对象版本核对本工具记录？'
                        : 'Confirm these entries were reviewed against the current target?'
                    }
                    onConfirm={() =>
                      change(() =>
                        api.confirmLink({
                          toolResultId,
                          version: view.link!.version,
                          targetHash: view.currentHash!,
                          targetRevisionId: view.currentRevisionId,
                          toolStateHash: view.toolStateHash,
                        })
                      )
                    }
                  >
                    <Button type="primary" disabled={!canConfirm} loading={busy}>
                      {safeStatus === 'changed' || safeStatus === 'unchecked'
                        ? zh
                          ? '重新核对'
                          : 'Review again'
                        : zh
                          ? '确认已核对当前版本'
                          : 'Confirm current version reviewed'}
                    </Button>
                  </Popconfirm>
                  {view.context ? (
                    <details>
                      <summary>{zh ? '本工具可查看的上下文' : 'Visible tool context'}</summary>
                      <pre>{view.context.preview}</pre>
                    </details>
                  ) : null}
                  {binding?.type === 'document' ? (
                    <details>
                      <summary>{zh ? '引用状态与已有审稿结果' : 'Citations and reviews'}</summary>
                      <p>
                        {zh
                          ? `引用 ${view.citations.length} 条 · 审稿记录 ${view.critics.length} 份`
                          : `${view.citations.length} citations · ${view.critics.length} reviews`}
                      </p>
                      {view.evidenceError ? (
                        <Alert
                          type="warning"
                          title={
                            zh ? '部分核对依据读取失败。' : 'Some evidence could not be loaded.'
                          }
                        />
                      ) : null}
                    </details>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      ) : null}

      <Modal
        open={selecting}
        title={zh ? '选择关联对象' : 'Choose a target'}
        okText={zh ? '确认关联' : 'Link'}
        cancelText={zh ? '取消' : 'Cancel'}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setSelecting(false);
        }}
        onOk={() =>
          change(() =>
            api.setLink({
              toolResultId,
              binding: selected,
              expectedVersion: view?.link?.version ?? null,
            })
          )
        }
      >
        <BindingPicker
          value={selected}
          onChange={setSelected}
          requiredDocument={false}
          disabled={busy}
          excludeId={toolResultId}
        />
        <p>
          {zh
            ? '更换关联会清除核对标记并保留当前填写记录。选择“独立使用”可解除关联。'
            : 'Changing the link clears the review checkpoint and keeps entries. Choose standalone to unlink.'}
        </p>
      </Modal>
    </section>
  );
}
