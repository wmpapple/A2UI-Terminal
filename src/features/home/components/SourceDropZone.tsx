import { InboxOutlined, PaperClipOutlined } from '@ant-design/icons';
import { Alert, Button } from 'antd';
import { useState, type DragEvent } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { ImportBatchModal } from '../../imports/components/ImportBatchModal';
import { useImportStore } from '../../imports/importStore';
import { useImportDropTarget } from '../../imports/useImportDropTarget';
import { useAppStore } from '../../../stores/useAppStore';
import styles from './SourceDropZone.module.css';

export function SourceDropZone() {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const workspace = useAppStore((state) => state.workspace);
  const sourceCount = useAppStore((state) =>
    Math.max(state.files.length, state.workspaceEntries.length)
  );
  const workspaceLoading = useAppStore((state) => state.workspaceLoading);
  const error = useAppStore((state) => state.workspaceError);
  const acceptImportedSelection = useAppStore((state) => state.acceptImportedSelection);
  const importLoading = useImportStore((state) => state.loading);
  const importError = useImportStore((state) => state.error);
  const selectImportSources = useImportStore((state) => state.select);
  const selectBrowserDropFallback = useImportStore((state) => state.selectBrowserDropFallback);
  const clearImportError = useImportStore((state) => state.clearError);
  const clearWorkspaceError = useAppStore((state) => state.clearWorkspaceError);
  const dropZoneRef = useImportDropTarget(workspace?.id);

  const requestTrustedSelection = () => void selectImportSources(workspace?.id);
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void selectBrowserDropFallback(workspace?.id);
  };

  return (
    <div>
      <div
        ref={dropZoneRef}
        className={`${styles.dropZone} ${dragging ? styles.dragging : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        data-testid="home-source-drop-zone"
      >
        <div className={styles.content}>
          <InboxOutlined className={styles.icon} />
          <span className={styles.title}>{t('homeSourceTitle')}</span>
          <span className={styles.description}>{t('homeSourceDescription')}</span>
          {workspace || sourceCount > 0 ? (
            <span className={styles.sourceSummary}>
              {t('homeSourceReady')
                .replace('{count}', String(sourceCount))
                .replace('{workspace}', workspace?.name ?? t('homeSelectedSources'))}
            </span>
          ) : null}
          <Button
            icon={<PaperClipOutlined />}
            loading={workspaceLoading || importLoading}
            onClick={requestTrustedSelection}
          >
            {t('chooseSources')}
          </Button>
        </div>
      </div>
      {error ? (
        <Alert
          className={styles.error}
          type="error"
          showIcon
          closable
          title={error}
          onClose={clearWorkspaceError}
        />
      ) : null}
      {importError ? (
        <Alert
          className={styles.error}
          type="error"
          showIcon
          closable
          title={importError}
          onClose={clearImportError}
        />
      ) : null}
      <ImportBatchModal onConfirmed={acceptImportedSelection} />
    </div>
  );
}
