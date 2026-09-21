import { HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import type { RefObject } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { AssistantMark } from './AssistantMark';
import styles from './ChatPanel.module.css';

interface ChatHeaderProps {
  configured: boolean;
  busy: boolean;
  modelLabel?: string;
  professionalTools: boolean;
  onNewSession: () => void;
  onOpenHistory: () => void;
  historyOpen: boolean;
  historyButtonRef: RefObject<HTMLButtonElement | null>;
}

export function ChatHeader({
  configured,
  busy,
  modelLabel,
  professionalTools,
  onNewSession,
  onOpenHistory,
  historyOpen,
  historyButtonRef,
}: ChatHeaderProps) {
  const { t } = useI18n();
  const status = t(
    busy ? 'chatResponding' : configured ? 'assistantReady' : 'assistantSetupNeeded'
  );
  const action = t(professionalTools ? 'newSession' : 'newConversation');
  return (
    <header className={styles.header}>
      <Tooltip title={t('sessionHistory')}>
        <Button
          ref={historyButtonRef}
          type="text"
          aria-label={t('sessionHistory')}
          aria-expanded={historyOpen}
          aria-haspopup="dialog"
          icon={<HistoryOutlined />}
          onClick={onOpenHistory}
        />
      </Tooltip>
      <AssistantMark />
      <div className={styles.headerText}>
        <strong>{t('assistant')}</strong>
        <div className={styles.headerStatus}>
          <Tooltip title={status}>
            <span
              role="status"
              aria-label={status}
              className={`${styles.statusDot} ${configured ? styles.online : ''} ${busy ? styles.busy : ''}`}
            />
          </Tooltip>
          <span className={styles.modelLabel} title={modelLabel || status}>
            {modelLabel || status}
          </span>
        </div>
      </div>

      <Tooltip title={action}>
        <Button
          className={styles.newChatButton}
          type="text"
          aria-label={action}
          icon={<PlusOutlined />}
          onClick={onNewSession}
        />
      </Tooltip>
    </header>
  );
}
