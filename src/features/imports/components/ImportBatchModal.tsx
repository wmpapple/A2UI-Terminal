import { Alert, Button, Checkbox, Modal, Tag } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ImportCapability, SelectedWorkspaceFiles } from '../../../shared/types/domain';
import { useImportStore } from '../importStore';
import styles from './ImportBatchModal.module.css';

const capabilityKeys: Record<ImportCapability, Parameters<ReturnType<typeof useI18n>['t']>[0]> = {
  editable_text: 'importCapabilityEditableText',
  read_only_text: 'importCapabilityReadOnlyText',
  planned_structured_data: 'importCapabilityPlannedTable',
  planned_visual_context: 'importCapabilityPlannedImage',
  unsupported: 'importCapabilityUnsupported',
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

interface ImportBatchModalProps {
  onConfirmed: (selection: SelectedWorkspaceFiles) => Promise<void>;
}

export function ImportBatchModal({ onConfirmed }: ImportBatchModalProps) {
  const { t } = useI18n();
  const batch = useImportStore((state) => state.batch);
  const acceptedItemIds = useImportStore((state) => state.acceptedItemIds);
  const loading = useImportStore((state) => state.loading);
  const error = useImportStore((state) => state.error);
  const toggle = useImportStore((state) => state.toggle);
  const confirm = useImportStore((state) => state.confirm);
  const cancel = useImportStore((state) => state.cancel);
  const clearError = useImportStore((state) => state.clearError);

  const confirmSelection = async () => {
    const result = await confirm();
    if (result?.workspace && result.documents.length > 0) {
      await onConfirmed({ workspace: result.workspace, documents: result.documents });
    }
  };

  return (
    <Modal
      open={Boolean(batch)}
      title={t('importBatchTitle')}
      width={760}
      destroyOnHidden
      closable={!loading}
      mask={{ closable: false }}
      onCancel={() => void cancel()}
      footer={
        <div className={styles.footer}>
          <span>{t('importSelectedCount').replace('{count}', String(acceptedItemIds.length))}</span>
          <div className={styles.footerActions}>
            <Button disabled={loading} onClick={() => void cancel()}>
              {t('cancel')}
            </Button>
            <Button
              type="primary"
              loading={loading}
              disabled={!batch?.canConfirm || acceptedItemIds.length === 0}
              onClick={() => void confirmSelection()}
            >
              {t('confirmImport')}
            </Button>
          </div>
        </div>
      }
    >
      <Alert type="info" showIcon title={t('importPrivacyNotice')} />
      {batch ? (
        <div className={styles.summary}>
          <span>
            {t('importBatchSummary')
              .replace('{count}', String(batch.items.length))
              .replace('{size}', formatBytes(batch.totalSizeBytes))}
          </span>
          <span>{t('importBatchLimit').replace('{count}', String(batch.maxFiles))}</span>
        </div>
      ) : null}
      {batch?.failureReason ? (
        <Alert className={styles.alert} type="warning" showIcon title={batch.failureReason} />
      ) : null}
      {error ? (
        <Alert
          className={styles.alert}
          type="error"
          showIcon
          closable
          title={error}
          onClose={clearError}
        />
      ) : null}
      <div className={styles.items} aria-label={t('importFileList')}>
        {batch?.items.map((item) => {
          const ready = item.status === 'ready' && item.readable;
          return (
            <article key={item.id} className={styles.item}>
              <Checkbox
                checked={acceptedItemIds.includes(item.id)}
                disabled={!ready || loading}
                aria-label={`${t('selectImportFile')} ${item.name}`}
                onChange={() => toggle(item.id)}
              />
              <div className={styles.itemBody}>
                <div className={styles.itemHeading}>
                  <strong>{item.name}</strong>
                  <span>{formatBytes(item.sizeBytes)}</span>
                  <Tag color={ready ? 'green' : item.status === 'planned' ? 'blue' : 'red'}>
                    {t(capabilityKeys[item.capability])}
                  </Tag>
                </div>
                {item.reason ? <p>{item.reason}</p> : null}
                {item.alternative ? (
                  <p className={styles.alternative}>
                    {t('importAlternative')}: {item.alternative}
                  </p>
                ) : null}
                {item.warnings.map((warning) => (
                  <p key={warning} className={styles.warning}>
                    {warning}
                  </p>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </Modal>
  );
}
