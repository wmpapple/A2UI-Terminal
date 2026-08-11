import { Alert, Button, Drawer, Empty, List, Modal, Popconfirm, Space, Spin, Tag } from 'antd';
import { useEffect } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { DocumentVersionSummary } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import styles from './VersionHistoryDrawer.module.css';

interface VersionHistoryDrawerProps {
  open: boolean;
  path: string;
  onClose: () => void;
}

export function VersionHistoryDrawer({ open, path, onClose }: VersionHistoryDrawerProps) {
  const { locale, t } = useI18n();
  const versions = useAppStore((state) => state.documentVersions);
  const preview = useAppStore((state) => state.versionPreview);
  const loading = useAppStore((state) => state.versionHistoryLoading);
  const error = useAppStore((state) => state.versionHistoryError);
  const loadVersions = useAppStore((state) => state.loadDocumentVersions);
  const previewVersion = useAppStore((state) => state.previewDocumentVersion);
  const restoreVersion = useAppStore((state) => state.restoreDocumentVersion);
  const clearPreview = useAppStore((state) => state.clearVersionPreview);

  useEffect(() => {
    if (open && path) void loadVersions(path);
  }, [loadVersions, open, path]);

  const sourceLabel = (version: DocumentVersionSummary) => {
    if (version.source === 'patch') {
      return version.versionKind === 'before' ? t('versionBeforePatch') : t('versionAfterPatch');
    }
    if (version.source === 'restore') return t('versionSourceRestore');
    if (version.source === 'autosave') return t('versionSourceAutosave');
    if (version.source === 'initial') return t('versionSourceInitial');
    return t('versionSourceLegacy');
  };

  const formatTime = (value: string) => {
    const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
  };

  return (
    <>
      <Drawer title={t('versionHistory')} open={open} size="large" onClose={onClose}>
        <p className={styles.path}>{path}</p>
        <p className={styles.hint}>{t('versionHistoryHint')}</p>
        {error ? <Alert type="error" showIcon title={error} className={styles.alert} /> : null}
        {loading && versions.length === 0 ? (
          <div className={styles.loading}>
            <Spin />
          </div>
        ) : versions.length === 0 ? (
          <Empty description={t('noVersionHistory')} />
        ) : (
          <List
            dataSource={versions}
            renderItem={(version) => (
              <List.Item
                actions={[
                  <Button
                    key="preview"
                    type="link"
                    onClick={() => void previewVersion(path, version.id)}
                  >
                    {t('previewVersion')}
                  </Button>,
                  version.isCurrent ? null : (
                    <Popconfirm
                      key="restore"
                      title={t('restoreVersionConfirm')}
                      description={t('restoreVersionDescription')}
                      okText={t('restoreVersion')}
                      cancelText={t('cancel')}
                      onConfirm={() => void restoreVersion(path, version.id)}
                    >
                      <Button type="link">{t('restoreVersion')}</Button>
                    </Popconfirm>
                  ),
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  title={
                    <Space wrap>
                      <span>{sourceLabel(version)}</span>
                      {version.isCurrent ? <Tag color="green">{t('currentVersionTag')}</Tag> : null}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2}>
                      <span>{formatTime(version.createdAt)}</span>
                      {version.summary ? <span>{version.summary}</span> : null}
                      <code>{version.contentHash.slice(0, 12)}</code>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>
      <Modal
        title={t('versionPreview')}
        open={Boolean(preview)}
        width={820}
        footer={
          preview ? (
            <Space>
              {!preview.isCurrent ? (
                <Popconfirm
                  title={t('restoreVersionConfirm')}
                  description={t('restoreVersionDescription')}
                  okText={t('restoreVersion')}
                  cancelText={t('cancel')}
                  onConfirm={() => void restoreVersion(path, preview.id)}
                >
                  <Button type="primary">{t('restoreVersion')}</Button>
                </Popconfirm>
              ) : null}
              <Button onClick={clearPreview}>{t('close')}</Button>
            </Space>
          ) : null
        }
        onCancel={clearPreview}
      >
        {preview ? (
          <>
            <Space wrap className={styles.previewMeta}>
              <Tag>{sourceLabel(preview)}</Tag>
              <span>{formatTime(preview.createdAt)}</span>
              <code>{preview.contentHash.slice(0, 12)}</code>
            </Space>
            <pre className={styles.preview}>{preview.content}</pre>
          </>
        ) : null}
      </Modal>
    </>
  );
}
