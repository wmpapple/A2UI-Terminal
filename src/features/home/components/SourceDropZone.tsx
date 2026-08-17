import { InboxOutlined, PaperClipOutlined } from '@ant-design/icons';
import { Alert, Button } from 'antd';
import { useState, type DragEvent } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import styles from './SourceDropZone.module.css';

export function SourceDropZone() {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const workspace = useAppStore((state) => state.workspace);
  const sourceCount = useAppStore((state) =>
    Math.max(state.files.length, state.workspaceEntries.length)
  );
  const loading = useAppStore((state) => state.workspaceLoading);
  const error = useAppStore((state) => state.workspaceError);
  const selectContextFiles = useAppStore((state) => state.selectContextFiles);
  const clearWorkspaceError = useAppStore((state) => state.clearWorkspaceError);

  const requestTrustedSelection = () => void selectContextFiles();
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    requestTrustedSelection();
  };

  return (
    <div>
      <div
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
          <Button icon={<PaperClipOutlined />} loading={loading} onClick={requestTrustedSelection}>
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
    </div>
  );
}
