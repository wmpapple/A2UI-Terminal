import { AppstoreOutlined, PaperClipOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { Button, Input, Tag, Tooltip } from 'antd';
import { useRef, useState } from 'react';
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
  const composing = useRef(false);
  const input = useRef<React.ComponentRef<typeof Input.TextArea>>(null);
  const shell = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<{ y: number; height: number } | null>(null);
  const [height, setHeight] = useState(180);
  const resize = (next: number) =>
    setHeight(Math.max(150, Math.min(480, window.innerHeight * 0.55, next)));

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
      {!prompt && !requestActive && !manifestLoading && (
        <div className={styles.promptSuggestions}>
          {(['suggestSummary', 'suggestImprove', 'suggestExplain'] as const).map((key) => (
            <Button
              key={key}
              size="small"
              onClick={() => {
                onPromptChange(t(key));
                input.current?.focus();
              }}
            >
              {t(key)}
            </Button>
          ))}
        </div>
      )}
      <div ref={shell} className={styles.inputShell} style={{ height }}>
        <div
          className={styles.inputResizeHandle}
          role="separator"
          tabIndex={0}
          aria-orientation="horizontal"
          aria-label={t('chatInputResizeHint')}
          aria-valuemin={150}
          aria-valuemax={480}
          aria-valuenow={height}
          title={t('chatInputResizeHint')}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeStart.current = {
              y: event.clientY,
              height: shell.current?.getBoundingClientRect().height ?? height,
            };
          }}
          onPointerMove={(event) => {
            if (resizeStart.current)
              resize(resizeStart.current.height + resizeStart.current.y - event.clientY);
          }}
          onPointerUp={(event) => {
            resizeStart.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            resizeStart.current = null;
          }}
          onLostPointerCapture={() => {
            resizeStart.current = null;
          }}
          onDoubleClick={() => setHeight(180)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              resize(height + (event.key === 'ArrowUp' ? 20 : -20));
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              resize(event.key === 'Home' ? 150 : 480);
            }
          }}
        />
        <div className={styles.contextBar}>
          <Button type="text" size="small" icon={<AppstoreOutlined />} onClick={onOpenContext}>
            {t(hasReviewedContext ? 'modifySendList' : 'context')}
          </Button>
          {activePath && <Tag title={activePath}>{activePath}</Tag>}
          {projectFiles.map((path) => (
            <Tag key={path} title={path}>
              {path}
            </Tag>
          ))}
          <Tag>
            {t(
              contextReviewed
                ? 'contextSaved'
                : hasReviewedContext
                  ? 'contextChanged'
                  : 'contextRequired'
            )}
          </Tag>
          <Tag>{t(processingLocation === 'local' ? 'localProcessing' : 'cloudProcessing')}</Tag>
        </div>
        <Input.TextArea
          ref={input}
          variant="borderless"
          value={prompt}
          disabled={manifestLoading}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={t('askPlaceholder')}
          rows={3}
          title={t('chatInputResizeHint')}
          aria-label={t('askPlaceholder')}
          aria-describedby="chat-send-shortcut"
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onPressEnter={(event) => {
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (!event.shiftKey || event.ctrlKey || event.metaKey) {
              event.preventDefault();
              if (!requestActive && !manifestLoading && prompt.trim()) onSend();
            }
          }}
        />
        <div className={styles.inputFooter}>
          <Tooltip title={t('dropFilesHint')}>
            <span className={styles.dropHint}>
              <PaperClipOutlined /> {t('dropFilesShort')}
            </span>
          </Tooltip>
          {requestActive ? (
            <Tooltip title={t('stop')}>
              <Button
                className={styles.sendButton}
                danger
                aria-label={t('stop')}
                icon={<StopOutlined />}
                onClick={onStop}
              />
            </Tooltip>
          ) : (
            <Tooltip title={t('send')}>
              <Button
                className={styles.sendButton}
                aria-label={t('send')}
                type="primary"
                icon={<SendOutlined />}
                disabled={!prompt.trim() || manifestLoading}
                loading={manifestLoading && !contextOpen}
                onClick={onSend}
              />
            </Tooltip>
          )}
        </div>
      </div>
      <span id="chat-send-shortcut" className={styles.shortcutHint}>
        {t('chatSendShortcut')}
      </span>
    </div>
  );
}
