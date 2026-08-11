import {
  CloudDownloadOutlined,
  DeleteOutlined,
  FileProtectOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Alert, Button, Input, Modal, Progress, Tag, message } from 'antd';
import { useState, useSyncExternalStore } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { desktopApi } from '../../../shared/platform/desktop';
import { getRuntimeMode } from '../../../shared/platform/runtime';
import {
  checkForAppUpdate,
  getUpdateSnapshot,
  installPendingUpdate,
  subscribeToUpdates,
} from '../appUpdater';
import styles from './SystemSettings.module.css';

const CLEAR_CONFIRMATION = 'DELETE_ALL_LOCAL_DATA';

export function SystemSettings() {
  const { t } = useI18n();
  const update = useSyncExternalStore(subscribeToUpdates, getUpdateSnapshot, getUpdateSnapshot);
  const isDesktop = getRuntimeMode() === 'desktop';
  const [clearOpen, setClearOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);

  const exportDiagnostics = async () => {
    setExporting(true);
    try {
      const result = await desktopApi.exportDiagnostics();
      if (result.exported) message.success(t('diagnosticsExported'));
    } catch {
      message.error(t('diagnosticsFailed'));
    } finally {
      setExporting(false);
    }
  };

  const clearAll = async () => {
    if (confirmation !== CLEAR_CONFIRMATION) return;
    setClearing(true);
    try {
      await desktopApi.clearAllLocalData(confirmation);
      message.success(t('localDataCleared'));
      window.setTimeout(() => window.location.reload(), 250);
    } catch {
      message.error(t('clearDataFailed'));
      setClearing(false);
    }
  };

  const updateColor =
    update.phase === 'available'
      ? 'green'
      : update.phase === 'error'
        ? 'red'
        : update.phase === 'unavailable'
          ? 'default'
          : 'blue';

  return (
    <section className={styles.section} aria-label={t('systemSettings')}>
      <div className={styles.heading}>
        <h3>{t('updatesAndPrivacy')}</h3>
        <Tag color={updateColor}>{t(`update_${update.phase}`)}</Tag>
      </div>
      {!isDesktop ? (
        <Alert type="info" showIcon title={t('desktopManagementOnly')} />
      ) : (
        <>
          {update.error ? <Alert type="warning" showIcon title={update.error} /> : null}
          {update.currentVersion ? (
            <span>
              {t('currentVersion')}: {update.currentVersion}
              {update.nextVersion ? ` → ${update.nextVersion}` : ''}
            </span>
          ) : null}
          {update.notes ? <p className={styles.notes}>{update.notes}</p> : null}
          {update.phase === 'downloading' ? (
            <Progress percent={update.progress} status="active" />
          ) : null}
          <div className={styles.actions}>
            <Button
              icon={<ReloadOutlined />}
              loading={update.phase === 'checking'}
              onClick={() => void checkForAppUpdate()}
            >
              {t('checkUpdates')}
            </Button>
            {update.phase === 'available' ? (
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={() => void installPendingUpdate()}
              >
                {t('installUpdate')}
              </Button>
            ) : null}
            <Button
              icon={<FileProtectOutlined />}
              loading={exporting}
              onClick={() => void exportDiagnostics()}
            >
              {t('exportDiagnostics')}
            </Button>
          </div>
          <Alert type="info" showIcon title={t('diagnosticsPrivacy')} />
          <div className={styles.dangerZone}>
            <Button danger icon={<DeleteOutlined />} onClick={() => setClearOpen(true)}>
              {t('clearAllLocalData')}
            </Button>
          </div>
        </>
      )}
      <Modal
        open={clearOpen}
        title={t('clearAllLocalData')}
        okText={t('clearDataConfirmButton')}
        okButtonProps={{
          danger: true,
          disabled: confirmation !== CLEAR_CONFIRMATION,
          loading: clearing,
        }}
        onOk={() => void clearAll()}
        onCancel={() => {
          setClearOpen(false);
          setConfirmation('');
        }}
      >
        <Alert
          type="warning"
          showIcon
          title={t('clearDataWarning')}
          description={t('projectFilesPreserved')}
        />
        <p>
          {t('typeToConfirm')} <strong className={styles.confirmToken}>{CLEAR_CONFIRMATION}</strong>
        </p>
        <Input
          autoFocus
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </Modal>
    </section>
  );
}
