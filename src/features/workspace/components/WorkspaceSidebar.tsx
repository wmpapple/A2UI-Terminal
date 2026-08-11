import {
  DeleteOutlined,
  FileMarkdownOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PaperClipOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Alert, Button, Dropdown, Input, Popconfirm, Select, Spin, Tag, Tooltip } from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import styles from './WorkspaceSidebar.module.css';

const iconFor = (path: string) =>
  path.endsWith('.md') ? <FileMarkdownOutlined /> : <FileTextOutlined />;

export function WorkspaceSidebar() {
  const { t } = useI18n();
  const {
    runtimeMode,
    workspace,
    recentWorkspaces,
    workspaceEntries,
    workspaceLoading,
    workspaceError,
  } = useAppStore();
  const activePath = useAppStore((state) => state.activePath);
  const openFile = useAppStore((state) => state.openFile);
  const selectWorkspace = useAppStore((state) => state.selectWorkspace);
  const selectContextFiles = useAppStore((state) => state.selectContextFiles);
  const restoreWorkspace = useAppStore((state) => state.restoreWorkspace);
  const removeCurrentWorkspace = useAppStore((state) => state.removeCurrentWorkspace);
  const clearWorkspaceError = useAppStore((state) => state.clearWorkspaceError);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const addFileToContext = useAppStore((state) => state.addFileToContext);
  const [query, setQuery] = useState('');
  const visibleFiles = useMemo(
    () => workspaceEntries.filter((file) => file.path.toLowerCase().includes(query.toLowerCase())),
    [workspaceEntries, query]
  );
  const isDesktop = runtimeMode === 'desktop';

  return (
    <aside className={styles.sidebar} aria-label={t('files')}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>{t('recent')}</span>
          <strong> {workspace?.name ?? (isDesktop ? t('noWorkspace') : 'A2UI-Terminal')}</strong>
        </div>
        <Tag color={isDesktop ? 'green' : 'blue'}>{isDesktop ? t('realWorkspace') : 'Mock'}</Tag>
      </div>
      <div className={styles.workspaceActions}>
        <div className={styles.primaryActions}>
          <Button
            block
            icon={<FolderOpenOutlined />}
            loading={workspaceLoading}
            onClick={() => void selectWorkspace()}
          >
            {t('openFolder')}
          </Button>
          <Button
            block
            icon={<PaperClipOutlined />}
            loading={workspaceLoading}
            onClick={() => void selectContextFiles()}
          >
            {t('addFiles')}
          </Button>
        </div>
      </div>
      {isDesktop && (recentWorkspaces.length > 0 || workspace) ? (
        <div className={styles.workspaceHistoryRow}>
          {recentWorkspaces.length > 0 ? (
            <Select
              className={styles.workspaceSelect}
              value={workspace?.id}
              placeholder={t('recent')}
              options={recentWorkspaces.map((item) => ({
                value: item.id,
                label: item.name,
                disabled: !item.available,
              }))}
              onChange={(workspaceId) => void restoreWorkspace(workspaceId)}
            />
          ) : null}
          {workspace ? (
            <Popconfirm
              title={t('removeWorkspace')}
              description={t('removeWorkspaceConfirm')}
              okButtonProps={{ danger: true }}
              onConfirm={() => void removeCurrentWorkspace()}
            >
              <Tooltip title={t('removeWorkspace')}>
                <Button danger aria-label={t('removeWorkspace')} icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          ) : null}
        </div>
      ) : null}
      {workspaceError ? (
        <Alert
          closable
          type="error"
          showIcon
          title={workspaceError}
          onClose={clearWorkspaceError}
        />
      ) : null}
      <Input
        allowClear
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        prefix={<SearchOutlined />}
        placeholder={t('searchFiles')}
        disabled={isDesktop && !workspace && workspaceEntries.length === 0}
      />
      <Spin spinning={workspaceLoading} classNames={{ root: styles.treeSpinner }}>
        <div className={styles.tree} role="tree">
          {visibleFiles.map((file) => (
            <Dropdown
              key={file.path}
              trigger={['contextMenu']}
              menu={{
                items: [{ key: 'add', label: t('addToConversation') }],
                onClick: async () => {
                  await openFile(file.path);
                  addFileToContext(activeSessionId, file.path);
                },
              }}
            >
              <Tooltip
                title={
                  file.readable
                    ? file.extracted
                      ? t('readOnlyDocument')
                      : file.path
                    : t('fileCannotOpen')
                }
                placement="right"
              >
                <button
                  type="button"
                  role="treeitem"
                  aria-selected={activePath === file.path}
                  aria-disabled={!file.readable}
                  disabled={!file.readable}
                  className={`${styles.file} ${activePath === file.path ? styles.active : ''}`}
                  onClick={() => void openFile(file.path)}
                >
                  {iconFor(file.path)}
                  <span>{file.sourceId ? file.name : file.path}</span>
                </button>
              </Tooltip>
            </Dropdown>
          ))}
        </div>
      </Spin>
      <div className={styles.footer}>{isDesktop ? t('controlledAccess') : t('webOnly')}</div>
    </aside>
  );
}
