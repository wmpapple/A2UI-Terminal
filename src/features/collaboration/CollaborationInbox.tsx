import { InboxOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Input, Spin, Tag } from 'antd';
import { useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import type { CollaborationItem, CollaborationOverview } from '../../shared/types/collaboration';
import { isWebMock } from '../../shared/platform/runtime';
import { userFacingError } from '../../shared/errors/userFacingError';
import { collaborationController as api } from './collaborationController';
import { CollaborationPanel } from './CollaborationPanel';
import styles from './CollaborationInbox.module.css';

type InboxFilter = 'pending' | 'applied' | 'handled';

function itemFilter(item: CollaborationItem): InboxFilter {
  if (item.status === 'applied') return 'applied';
  if (item.status === 'received') return 'pending';
  return 'handled';
}

export function CollaborationInbox({
  overview,
  loading,
  error,
  refresh,
}: {
  overview: CollaborationOverview | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [handlingId, setHandlingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const items = overview?.inbox ?? [];
  const counts = {
    pending: overview?.pendingCount ?? 0,
    applied: items.filter((item) => itemFilter(item) === 'applied').length,
    handled: items.filter((item) => itemFilter(item) === 'handled').length,
  };
  const visible = items.filter(
    (item) =>
      itemFilter(item) === filter &&
      `${item.title} ${item.senderName ?? ''}`
        .toLocaleLowerCase(locale)
        .includes(query.trim().toLocaleLowerCase(locale))
  );

  const importPackage = async () => {
    setImporting(true);
    setActionError('');
    try {
      const id = await api.import();
      if (id) {
        await refresh();
        setFilter('pending');
        setSelectedId(id);
      }
    } catch (cause) {
      setActionError(userFacingError(cause, locale));
    } finally {
      setImporting(false);
    }
  };
  const markHandled = async (id: string) => {
    setHandlingId(id);
    setActionError('');
    try {
      await api.markHandled(id);
      await refresh();
    } catch (cause) {
      setActionError(userFacingError(cause, locale));
    } finally {
      setHandlingId(null);
    }
  };

  return (
    <section
      id="collaboration-inbox-panel"
      role="tabpanel"
      aria-labelledby="collaboration-inbox-tab"
      className={styles.inbox}
    >
      <div className={styles.toolbar}>
        <Input
          aria-label={zh ? '搜索协作内容' : 'Search collaboration items'}
          placeholder={zh ? '搜索协作内容' : 'Search collaboration items'}
          prefix={<SearchOutlined />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          allowClear
        />
        <Button
          type="primary"
          icon={<UploadOutlined />}
          loading={importing}
          disabled={isWebMock()}
          onClick={() => void importPackage()}
        >
          {zh ? '导入协作包' : 'Import package'}
        </Button>
      </div>
      <p className={styles.scopeNote}>
        {zh
          ? '收到的分享先保存在收件箱；查看或审阅不会把它加入我的成果。'
          : 'Received shares stay in the inbox. Viewing or reviewing does not add them to My results.'}
      </p>
      {(error || actionError) && <Alert type="error" showIcon title={error || actionError} />}
      {isWebMock() && (
        <p className={styles.scopeNote}>
          {zh ? '本地协作请在桌面版使用。' : 'Local collaboration is available in the desktop app.'}
        </p>
      )}
      <div className={styles.filters} role="tablist" aria-label={zh ? '协作状态' : 'Inbox status'}>
        {(
          [
            ['pending', zh ? '待处理' : 'Pending'],
            ['applied', zh ? '已应用' : 'Applied'],
            ['handled', zh ? '已处理' : 'Handled'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={filter === key ? styles.active : undefined}
            onClick={() => setFilter(key)}
          >
            {label}
            {counts[key] > 0 && <span className={styles.count}>{counts[key]}</span>}
          </button>
        ))}
      </div>
      {loading && !overview ? (
        <div className={styles.loading}>
          <Spin />
        </div>
      ) : null}
      {!loading && visible.length === 0 && (
        <div className={styles.empty}>
          <Empty
            image={<InboxOutlined />}
            description={
              query
                ? zh
                  ? '没有匹配的协作内容'
                  : 'No matching items'
                : filter === 'pending'
                  ? zh
                    ? '暂无待处理的协作内容'
                    : 'Nothing pending'
                  : zh
                    ? '此状态下暂无内容'
                    : 'No items in this status'
            }
          />
        </div>
      )}
      <div className={styles.list} role="tabpanel">
        {visible.map((item) => (
          <article className={styles.item} key={item.id}>
            <div className={styles.itemContent}>
              <div className={styles.itemTitle}>
                <strong>{item.title}</strong>
                <Tag>
                  {item.status === 'applied'
                    ? zh
                      ? '已应用修改'
                      : 'Changes applied'
                    : item.status === 'rejected'
                      ? zh
                        ? '已拒绝修改'
                        : 'Changes rejected'
                      : item.status === 'replied'
                        ? zh
                          ? '意见已保存'
                          : 'Feedback saved'
                        : item.status === 'handled'
                          ? zh
                            ? '已处理'
                            : 'Handled'
                          : zh
                            ? '待处理'
                            : 'Pending'}
                </Tag>
              </div>
              <p>
                {zh ? '来自：' : 'From: '}
                {item.senderName || (zh ? '未提供' : 'Unknown')}
                {zh ? '（未验证）' : ' (unverified)'}
              </p>
              <p>
                {zh ? '内容：' : 'Request: '}
                {item.kind === 'feedback'
                  ? zh
                    ? '审阅意见'
                    : 'Feedback'
                  : item.permission === 'read'
                    ? zh
                      ? '仅供查看'
                      : 'Read only'
                    : zh
                      ? '请帮忙审阅'
                      : 'Review requested'}
              </p>
              <time>{item.createdAt}</time>
            </div>
            <div className={styles.actions}>
              <Button onClick={() => setSelectedId(item.id)}>{zh ? '打开' : 'Open'}</Button>
              {item.status === 'received' && (
                <Button
                  type="text"
                  loading={handlingId === item.id}
                  onClick={() => void markHandled(item.id)}
                >
                  {zh ? '标记已处理' : 'Mark handled'}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {selectedId && (
        <CollaborationPanel
          key={selectedId}
          inboxId={selectedId}
          onChanged={refresh}
          onClose={() => {
            setSelectedId(null);
            void refresh();
          }}
        />
      )}
    </section>
  );
}
