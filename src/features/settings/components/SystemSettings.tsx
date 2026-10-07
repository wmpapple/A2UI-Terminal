import {
  CloudDownloadOutlined,
  DeleteOutlined,
  FileProtectOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { Alert, Button, Input, Modal, Progress, Tag, message } from 'antd';
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

interface Props {
  view?: 'all' | 'updates' | 'privacy';
  professional?: boolean;
}

export function SystemSettings({ view = 'all', professional = true }: Props) {
  const { t, locale } = useI18n();
  const zh = locale === 'zh-CN';
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

  const updateSourceMissing =
    update.phase === 'unavailable' ||
    /endpoints? (set|configured)|endpoints?:? none/i.test(update.error ?? '');
  return (
    <section className={styles.section} aria-label={t('systemSettings')}>
      {view !== 'privacy' && (
        <>
          <section className={styles.group} aria-labelledby="app-update-heading">
            <div className={styles.heading}>
              <h3 id="app-update-heading">{zh ? '应用更新' : 'App updates'}</h3>
              {!updateSourceMissing && (
                <Tag color={update.phase === 'available' ? 'success' : 'default'}>
                  {t(`update_${update.phase}`)}
                </Tag>
              )}
            </div>
            <p className={styles.muted}>
              {t('currentVersion')}:{' '}
              {update.currentVersion || (zh ? '检查后显示' : 'Shown after checking')}
              {update.nextVersion ? ` → ${update.nextVersion}` : ''}
            </p>
            {!isDesktop ? (
              <p className={styles.muted}>{t('desktopManagementOnly')}</p>
            ) : (
              <>
                {!updateSourceMissing && update.error && (
                  <p className={styles.muted} role="status">
                    {update.error}
                  </p>
                )}
                {update.notes && <p className={styles.notes}>{update.notes}</p>}
                {update.phase === 'downloading' && (
                  <Progress percent={update.progress} status="active" />
                )}
                {!updateSourceMissing && (
                  <div className={styles.actions}>
                    <Button
                      icon={<ReloadOutlined />}
                      loading={update.phase === 'checking'}
                      onClick={() => void checkForAppUpdate()}
                    >
                      {t('checkUpdates')}
                    </Button>
                    {update.phase === 'available' && (
                      <Button
                        type="primary"
                        icon={<CloudDownloadOutlined />}
                        onClick={() => void installPendingUpdate()}
                      >
                        {t('installUpdate')}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
          {professional && isDesktop && (
            <section className={styles.group} aria-labelledby="diagnostics-heading">
              <h3 id="diagnostics-heading">{zh ? '诊断' : 'Diagnostics'}</h3>
              <p className={styles.muted}>{t('diagnosticsPrivacy')}</p>
              <Button
                icon={<FileProtectOutlined />}
                loading={exporting}
                onClick={() => void exportDiagnostics()}
              >
                {t('exportDiagnostics')}
              </Button>
            </section>
          )}
        </>
      )}
      {view !== 'updates' && (
        <>
          <section className={styles.group} aria-labelledby="local-data-heading">
            <h3 id="local-data-heading">{zh ? '本地数据' : 'Local data'}</h3>
            <p className={styles.muted}>
              {zh
                ? '资料库、成果、工具状态、写作偏好和历史记录保存在本机。'
                : 'Library, results, tool state, writing profiles and history are stored locally.'}
            </p>
            <Button
              type="link"
              className={styles.link}
              onClick={() => {
                window.location.hash = '/knowledge?tab=packs';
              }}
            >
              {t('manageLibraryPacks')}
            </Button>
          </section>
          <TelemetryPrivacySettings />
          {isDesktop && (
            <section className={styles.dangerZone} aria-labelledby="clear-data-zone-title">
              <div className={styles.dangerHeading}>
                <ExclamationCircleOutlined aria-hidden="true" />
                <h3 id="clear-data-zone-title">{zh ? '危险操作' : 'Danger zone'}</h3>
              </div>
              <strong>{t('clearAllLocalData')}</strong>
              <p>
                {zh
                  ? '将永久删除资料库、成果、工具状态、写作偏好和本地历史；不会删除工作区原始文件。'
                  : 'Permanently deletes your library, results, tool state, writing profiles and local history. Original workspace files are preserved.'}
              </p>
              <Button danger icon={<DeleteOutlined />} onClick={() => setClearOpen(true)}>
                {t('clearAllLocalData')}
              </Button>
            </section>
          )}
        </>
      )}
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
