import { AppstoreOutlined, PaperClipOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { Button, Input, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ProcessingLocation } from '../../../shared/types/domain';
import styles from './ChatPanel.module.css';

interface ChatComposerProps {
  prompt: string;
  activePath: string;
  projectFiles: string[];
  processingLocation: ProcessingLocation;
  hasReviewedContext: boolean;
  contextReviewed: boolean;
  requestActive: boolean;
  manifestLoading: boolean;
  contextOpen: boolean;
  onPromptChange: (prompt: string) => void;
  onOpenContext: () => void;
  onSend: () => void;
  onStop: () => void;
  onDropFiles: (files: FileList) => void;
}

export function ChatComposer({
  prompt,
  activePath,
  projectFiles,
  processingLocation,
  hasReviewedContext,
  contextReviewed,
  requestActive,
  manifestLoading,
  contextOpen,
  onPromptChange,
  onOpenContext,
  onSend,
  onStop,
  onDropFiles,
}: ChatComposerProps) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`${styles.composer} ${dragging ? styles.dragging : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        onDropFiles(event.dataTransfer.files);
      }}
    >
      <div className={styles.contextBar}>
        <Button type="text" size="small" icon={<AppstoreOutlined />} onClick={onOpenContext}>
          {t(hasReviewedContext ? 'modifySendList' : 'context')}
        </Button>
        {activePath && <Tag color="blue">{activePath}</Tag>}
        {projectFiles.map((path) => (
          <Tag key={path}>{path}</Tag>
        ))}
        <Tag color={contextReviewed ? 'green' : 'orange'}>
          {t(
            contextReviewed
              ? 'contextSaved'
              : hasReviewedContext
                ? 'contextChanged'
                : 'contextRequired'
          )}
        </Tag>
        <Tag color={processingLocation === 'local' ? 'green' : 'gold'}>
          {t(processingLocation === 'local' ? 'localProcessing' : 'cloudProcessing')}
        </Tag>
        <Tooltip title={t('dropFilesHint')}>
          <span className={styles.dropHint}>
            <PaperClipOutlined /> {t('dropFilesShort')}
          </span>
        </Tooltip>
      </div>
      <Input.TextArea
        value={prompt}
        disabled={manifestLoading}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder={t('askPlaceholder')}
        autoSize={{ minRows: 3, maxRows: 7 }}
        onPressEnter={(event) => {
          if (!event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
      />
      {requestActive ? (
        <Button danger icon={<StopOutlined />} onClick={onStop}>
          {t('stop')}
        </Button>
      ) : (
        <Button
          type="primary"
          icon={<SendOutlined />}
          disabled={!prompt.trim() || manifestLoading}
          loading={manifestLoading && !contextOpen}
          onClick={onSend}
        >
          {t('send')}
        </Button>
      )}
    </div>
  );
}
