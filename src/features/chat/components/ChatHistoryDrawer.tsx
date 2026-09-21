import {
  CommentOutlined,
  SearchOutlined,
  PushpinOutlined,
  PushpinFilled,
  DeleteOutlined,
} from '@ant-design/icons';
import { Alert, Button, Drawer, Input, Modal } from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ChatSession } from '../../../shared/types/domain';
import { groupChatHistory } from '../chatHistoryTimeline';
import styles from './ChatHistoryDrawer.module.css';

interface ChatHistoryDrawerProps {
  open: boolean;
  sessions: ChatSession[];
  activeSessionId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => Promise<void>;
  onPin?: (id: string, pinned: boolean) => Promise<void>;
  busy?: boolean;
  error?: string | null;
}

export function ChatHistoryDrawer({
  open,
  sessions,
  activeSessionId,
  onClose,
  onSelect,
  onDelete,
  onPin,
  busy = false,
  error,
}: ChatHistoryDrawerProps) {
  const { t, locale } = useI18n();
  const today = new Date().toDateString();
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);
  const [pending, setPending] = useState(false);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sessions.filter(
      (session) =>
        session.title.toLocaleLowerCase().includes(needle) ||
        session.messages.some((message) => message.content.toLocaleLowerCase().includes(needle))
    );
  }, [sessions, query]);
  const groups = useMemo(
    () => [
      {
        key: 'historyPinned' as const,
        entries: groupChatHistory(
          filtered.filter((session) => session.pinned),
          new Date(today)
        ).flatMap((group) => group.entries),
      },
      ...groupChatHistory(
        filtered.filter((session) => !session.pinned),
        new Date(today)
      ),
    ],
    [filtered, today]
  );
  const [limit, setLimit] = useState(50);
  const visibleIds = new Set(
    groups
      .flatMap((group) => group.entries)
      .slice(0, limit)
      .map(({ session }) => session.id)
  );
  const dateFormat = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <Drawer
      open={open}
      title={t('sessionHistory')}
      placement="left"
      size="min(320px, 100%)"
      getContainer={false}
      rootClassName={styles.drawer}
      rootStyle={{ position: 'absolute' }}
      classNames={{ section: styles.section, header: styles.header, body: styles.body }}
      closable={{ 'aria-label': t('close') }}
      onClose={onClose}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (!visible) setLimit(50);
      }}
    >
      {error && <Alert type="error" showIcon title={error} />}
      <Input
        className={styles.search}
        prefix={<SearchOutlined />}
        allowClear
        value={query}
        aria-label={t('historySearch')}
        placeholder={t('historySearch')}
        onChange={(event) => {
          setQuery(event.target.value);
          setLimit(50);
        }}
      />
      {sessions.length > 0 && filtered.length === 0 && (
        <p className={styles.empty}>{t('historyNoMatches')}</p>
      )}
      {sessions.length === 0 && <p className={styles.empty}>{t('historyEmpty')}</p>}
      {groups.map(({ key, entries }) => {
        const visible = entries.filter(({ session }) => visibleIds.has(session.id));
        return (
          visible.length > 0 && (
            <section key={key} aria-label={t(key)}>
              <h3 className={styles.groupTitle}>{t(key)}</h3>
              {visible.map(({ session, date }) => (
                <div key={session.id} className={styles.row}>
                  <button
                    type="button"
                    className={styles.item}
                    aria-current={session.id === activeSessionId ? 'true' : undefined}
                    onClick={() => onSelect(session.id)}
                    title={session.title}
                  >
                    <CommentOutlined className={styles.icon} aria-hidden="true" />
                    <span className={styles.details}>
                      <span className={styles.title}>{session.title}</span>
                      <span className={styles.meta}>
                        <span>
                          {session.messages.length} {t('sessionMessageCount')}
                        </span>
                        {date && (
                          <time dateTime={date.toISOString()} title={date.toLocaleString(locale)}>
                            {dateFormat.format(date)}
                          </time>
                        )}
                      </span>
                    </span>
                  </button>
                  <div className={styles.actions}>
                    {onPin && (
                      <Button
                        size="small"
                        type="text"
                        disabled={pending}
                        icon={session.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                        title={t(session.pinned ? 'unpinConversation' : 'pinConversation')}
                        aria-label={`${t(session.pinned ? 'unpinConversation' : 'pinConversation')}: ${session.title}`}
                        onClick={async () => {
                          setPending(true);
                          try {
                            await onPin(session.id, !session.pinned);
                          } finally {
                            setPending(false);
                          }
                        }}
                      />
                    )}
                    {onDelete && (
                      <Button
                        size="small"
                        type="text"
                        disabled={busy || pending}
                        icon={<DeleteOutlined />}
                        title={t('deleteConversation')}
                        aria-label={`${t('deleteConversation')}: ${session.title}`}
                        onClick={() => setDeleteTarget(session)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </section>
          )
        );
      })}
      {filtered.length > limit && (
        <Button block type="text" onClick={() => setLimit((value) => value + 50)}>
          {t('historyMore')}
        </Button>
      )}
      <Modal
        open={Boolean(deleteTarget)}
        title={t('deleteConversation')}
        okText={t('confirmDelete')}
        cancelText={t('cancel')}
        okButtonProps={{ danger: true, disabled: busy }}
        confirmLoading={pending}
        closable={!pending}
        mask={{ closable: !pending }}
        cancelButtonProps={{ disabled: pending }}
        onCancel={() => {
          if (!pending) setDeleteTarget(null);
        }}
        onOk={async () => {
          if (!deleteTarget || !onDelete || pending || busy) return;
          setPending(true);
          try {
            await onDelete(deleteTarget.id);
            setDeleteTarget(null);
          } finally {
            setPending(false);
          }
        }}
      >
        <p>{deleteTarget?.title}</p>
        <p>{t('deleteConversationHint')}</p>
      </Modal>
    </Drawer>
  );
}
