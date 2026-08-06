import { Alert, Checkbox, Divider, Modal, Progress, Select, Tag } from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import type { ContextSelection } from '../../../shared/types/domain';
import styles from './ContextSelector.module.css';

interface Props {
  open: boolean;
  initialSelection: ContextSelection;
  onCancel: () => void;
  onConfirm: (selection: ContextSelection) => void;
}

export function ContextSelector({ open, initialSelection, onCancel, onConfirm }: Props) {
  const { t } = useI18n();
  const files = useAppStore((state) => state.files);
  const activePath = useAppStore((state) => state.activePath);
  const selectedText = useAppStore((state) => state.selectedText);
  const [selection, setSelection] = useState<ContextSelection>(() => ({
    ...initialSelection,
    selection: initialSelection.selection && selectedText.length > 0,
  }));
  const estimatedTokens = useMemo(() => {
    const active = files.find((file) => file.path === activePath);
    const chars =
      (selection.selection ? selectedText.length : 0) +
      (selection.currentFile ? (active?.content.length ?? 0) : 0) +
      (selection.recentMessages ? selection.recentMessageCount * 160 : 0) +
      selection.projectFiles.reduce(
        (sum, path) => sum + (files.find((file) => file.path === path)?.content.length ?? 0),
        0
      );
    return Math.ceil(chars / 3.2);
  }, [activePath, files, selectedText.length, selection]);

  const setFlag = (key: 'selection' | 'currentFile' | 'recentMessages', checked: boolean) =>
    setSelection((current) => ({ ...current, [key]: checked }));

  return (
    <Modal
      open={open}
      title={t('contextTitle')}
      okText={t('saveContext')}
      cancelText={t('cancel')}
      onCancel={onCancel}
      onOk={() => onConfirm(selection)}
      width={620}
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
            onChange={(event) => setFlag('currentFile', event.target.checked)}
          >
            {t('currentFile')} <Tag color="blue">{activePath}</Tag>
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
            .filter((file) => file.path !== activePath)
            .map((file) => (
              <Checkbox value={file.path} key={file.path}>
                {file.path}
              </Checkbox>
            ))}
        </Checkbox.Group>
        <div className={styles.tokens}>
          <span>{t('tokenEstimate')}</span>
          <strong>{estimatedTokens.toLocaleString()}</strong>
        </div>
        <Progress
          percent={Math.min(100, Math.round((estimatedTokens / 8000) * 100))}
          showInfo={false}
          size="small"
        />
      </div>
    </Modal>
  );
}
