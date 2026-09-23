import {
  CloudDownloadOutlined,
  DeleteOutlined,
  FileProtectOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { Alert, Button, Divider, Input, Modal, Progress, Tag, message } from 'antd';
import { useState, useSyncExternalStore } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { clearWebviewLocalData, scheduleApplicationReload } from '../../../app/localData';
import { getRuntimeMode } from '../../../shared/platform/runtime';
import {
  checkForAppUpdate,
  getUpdateSnapshot,
  installPendingUpdate,
  subscribeToUpdates,
} from '../appUpdater';
import styles from './SystemSettings.module.css';
import { systemController } from '../systemController';
import { TelemetryPrivacySettings } from './TelemetryPrivacySettings';

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
      const result = await systemController.exportDiagnostics();
      if (result.exported) message.success(t('diagnosticsExported'));
    } catch {
      message.error(t('diagnosticsFailed'));
    } finally {
      setExporting(false);
    }
  };

  const clearAll = async () => {
    if (confirmation !== CLEAR_CONFIRMATION || clearing) return;
    setClearing(true);
    try {
      await systemController.clearAllLocalData(confirmation);
      clearWebviewLocalData();
      message.success(t('localDataCleared'));
      scheduleApplicationReload();
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
        <Tag className={styles.updateStatus} data-tone={updateColor}>
          {t(`update_${update.phase}`)}
        </Tag>
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
          <section className={styles.dangerZone} aria-labelledby="clear-data-zone-title">
            <div className={styles.dangerHeading}>
              <ExclamationCircleOutlined aria-hidden="true" />
              <h4 id="clear-data-zone-title">{t('clearDataDangerTitle')}</h4>
            </div>
            <p>{t('clearDataDangerDescription')}</p>
            <Button danger icon={<DeleteOutlined />} onClick={() => setClearOpen(true)}>
              {t('clearAllLocalData')}
            </Button>
          </section>
        </>
      )}
      <Divider />
      <TelemetryPrivacySettings />
      <Divider />
      <Button
        onClick={() => {
          window.location.hash = '/knowledge?tab=packs';
        }}
      >
        {t('manageLibraryPacks')}
      </Button>
      <Modal
        open={clearOpen}
        title={t('clearAllLocalData')}
        okText={t('clearDataConfirmButton')}
        cancelText={t('cancel')}
        mask={{ closable: false }}
        closable={!clearing}
        keyboard={!clearing}
        cancelButtonProps={{ disabled: clearing }}
        okButtonProps={{
          className: styles.dangerButton,
          danger: true,
          disabled: confirmation !== CLEAR_CONFIRMATION || clearing,
          loading: clearing,
        }}
        onOk={() => void clearAll()}
        onCancel={() => {
          if (clearing) return;
          setClearOpen(false);
          setConfirmation('');
        }}
      >
        <Alert
          className={styles.dangerNotice}
          type="error"
          showIcon
          title={t('clearDataWarning')}
          description={t('projectFilesPreserved')}
        />
        <p id="clear-data-confirm-instruction">
          {t('typeToConfirm')} <strong className={styles.confirmToken}>{CLEAR_CONFIRMATION}</strong>
        </p>
        <Input
          autoFocus
          aria-label={t('typeToConfirm')}
          aria-describedby="clear-data-confirm-instruction"
          autoComplete="off"
          spellCheck={false}
          disabled={clearing}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </Modal>
    </section>
  );
}
