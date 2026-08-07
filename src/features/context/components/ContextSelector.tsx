import { Alert, Checkbox, Divider, Modal, Progress, Select, Tag } from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ContextSelection } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import {
  buildContextSnapshot,
  isSensitivePath,
  normalizeContextSelection,
} from '../contextSnapshot';
import styles from './ContextSelector.module.css';

interface Props {
  open: boolean;
  prompt: string;
  initialSelection: ContextSelection;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: (selection: ContextSelection, sensitiveConfirmed: boolean) => void;
}

export function ContextSelector({
  open,
  prompt,
  initialSelection,
  confirmText,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  const files = useAppStore((state) => state.files);
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activePath = useAppStore((state) => state.activePath);
  const selectedText = useAppStore((state) => state.selectedText);
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false);
  const [selection, setSelection] = useState<ContextSelection>(() =>
    normalizeContextSelection(initialSelection, selectedText)
  );
  const recentMessages = useMemo(
    () => sessions.find((session) => session.id === activeSessionId)?.messages ?? [],
    [activeSessionId, sessions]
  );
  const snapshot = useMemo(
    () =>
      buildContextSnapshot({
        selection,
        files,
        activePath,
        selectedText,
        recentMessages,
        prompt,
      }),
    [activePath, files, prompt, recentMessages, selectedText, selection]
  );

  const setFlag = (key: 'selection' | 'currentFile' | 'recentMessages', checked: boolean) =>
    setSelection((current) => ({ ...current, [key]: checked }));
  const requiresSensitiveConfirmation = snapshot.warnings.some((warning) =>
    warning.includes('possible secret')
  );

  return (
    <Modal
      open={open}
      title={t('contextTitle')}
      okText={confirmText ?? t('confirmAndSend')}
      cancelText={t('cancel')}
      onCancel={onCancel}
      onOk={() => onConfirm(selection, sensitiveConfirmed || !requiresSensitiveConfirmation)}
      okButtonProps={{ disabled: requiresSensitiveConfirmation && !sensitiveConfirmed }}
      width={660}
    >
      <div className={styles.body}>
        <Alert type="info" showIcon title={t('privacyHint')} />
        <div className={styles.options}>
          <Checkbox
            disabled={selectedText.length === 0}
            checked={selection.selection}
            onChange={(event) => setFlag('selection', event.target.checked)}
          >
            {t('selection')}{' '}
            <Tag color={selectedText.length > 0 ? 'green' : 'default'}>
              {selectedText.length > 0 ? `${selectedText.length} chars` : t('noSelection')}
            </Tag>
          </Checkbox>
          <Checkbox
            checked={selection.currentFile}
            disabled={!activePath || isSensitivePath(activePath)}
            onChange={(event) => setFlag('currentFile', event.target.checked)}
          >
            {t('currentFile')} {activePath && <Tag color="blue">{activePath}</Tag>}
          </Checkbox>
          <Checkbox
            checked={selection.recentMessages}
            onChange={(event) => setFlag('recentMessages', event.target.checked)}
          >
            {t('recentMessages')}
          </Checkbox>
          <Select
            size="small"
            value={selection.recentMessageCount}
            disabled={!selection.recentMessages}
            aria-label={t('recentMessageCount')}
            options={[3, 5, 10, 20].map((count) => ({
              value: count,
              label: t('recentMessageCountValue').replace('{count}', String(count)),
            }))}
            onChange={(recentMessageCount) =>
              setSelection((current) => ({ ...current, recentMessageCount }))
            }
          />
        </div>
        <Divider>{t('projectFiles')}</Divider>
        <Checkbox.Group
          value={selection.projectFiles}
          onChange={(paths) =>
            setSelection((current) => ({ ...current, projectFiles: paths as string[] }))
          }
          className={styles.fileOptions}
        >
          {files
            .filter((file) => file.path !== activePath && !isSensitivePath(file.path))
            .map((file) => (
              <Checkbox value={file.path} key={file.path}>
                {file.path}
              </Checkbox>
            ))}
        </Checkbox.Group>
        <Divider>{t('finalSendList')}</Divider>
        <div className={styles.sourceList}>
          {snapshot.sources.length === 0 && !selection.recentMessages ? (
            <Tag>{t('noFileContext')}</Tag>
          ) : (
            snapshot.sources.map((source) => (
              <Tag key={`${source.kind}:${source.label}`}>{source.label}</Tag>
            ))
          )}
          {selection.recentMessages && (
            <Tag color="purple">
              {t('recentMessageCountValue').replace(
                '{count}',
                String(selection.recentMessageCount)
              )}
            </Tag>
          )}
        </div>
        {snapshot.warnings.length > 0 && (
          <Alert
            type="warning"
            showIcon
            title={t('sensitiveWarning')}
            description={snapshot.warnings.join('\n')}
          />
        )}
        {requiresSensitiveConfirmation && (
          <Checkbox
            checked={sensitiveConfirmed}
            onChange={(event) => setSensitiveConfirmed(event.target.checked)}
          >
            {t('sensitiveConfirm')}
          </Checkbox>
        )}
        <div className={styles.tokens}>
          <span>
            {t('contextCharacters').replace('{count}', snapshot.characterCount.toLocaleString())}
          </span>
          <strong>
            {t('tokenEstimate')}: {snapshot.estimatedTokens.toLocaleString()}
          </strong>
        </div>
        <Progress
          percent={Math.min(100, Math.round((snapshot.estimatedTokens / 128000) * 100))}
          showInfo={false}
          size="small"
        />
      </div>
    </Modal>
  );
}
