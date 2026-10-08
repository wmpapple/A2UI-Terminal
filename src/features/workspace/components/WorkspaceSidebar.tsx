import {
  DeleteOutlined,
  DownOutlined,
  FileMarkdownOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PaperClipOutlined,
  SearchOutlined,
  InfoCircleOutlined,
  LayoutOutlined,
  FolderOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Alert, Button, Dropdown, Input, Popconfirm, Select, Spin, Tag, Tooltip } from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import { useImportStore } from '../../imports/importStore';
import {
  displayWorkspacePath,
  workspaceFolderPaths,
  workspaceParentFolder,
} from '../../../shared/workspacePath';
import styles from './WorkspaceSidebar.module.css';

const iconFor = (path: string) =>
  path.endsWith('.md') ? <FileMarkdownOutlined /> : <FileTextOutlined />;

interface Props {
  highlightActiveFile?: boolean;
  currentResultTitle?: string;
  onActivateWorkspace?: () => void;
  onBeforeOpenFile?: (path: string, name: string) => boolean | Promise<boolean>;
  onOpenCanvas?: (path: string, kind: 'file' | 'folder') => void;
}

export function WorkspaceSidebar({
  highlightActiveFile = true,
  currentResultTitle,
  onActivateWorkspace,
  onBeforeOpenFile,
  onOpenCanvas,
}: Props) {
  const { t, locale } = useI18n();
  const runtimeMode = useAppStore((state) => state.runtimeMode);
  const workspace = useAppStore((state) => state.workspace);
  const recentWorkspaces = useAppStore((state) => state.recentWorkspaces);
  const workspaceEntries = useAppStore((state) => state.workspaceEntries);
  const workspaceLoading = useAppStore((state) => state.workspaceLoading);
  const workspaceError = useAppStore((state) => state.workspaceError);
  const activePath = useAppStore((state) => state.activePath);
  const recoveryDraftSummaries = useAppStore((state) => state.recoveryDraftSummaries);
  const openFile = useAppStore((state) => state.openFile);
  const selectWorkspace = useAppStore((state) => state.selectWorkspace);
  const selectImportSources = useImportStore((state) => state.select);
  const importLoading = useImportStore((state) => state.loading);
  const restoreWorkspace = useAppStore((state) => state.restoreWorkspace);
  const removeCurrentWorkspace = useAppStore((state) => state.removeCurrentWorkspace);
  const clearWorkspaceError = useAppStore((state) => state.clearWorkspaceError);
  const discardRecoveryDraft = useAppStore((state) => state.discardRecoveryDraft);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const addFileToContext = useAppStore((state) => state.addFileToContext);
  const [query, setQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const visibleFiles = useMemo(
    () =>
      workspaceEntries.filter((file) =>
        displayWorkspacePath(file.path).toLowerCase().includes(query.toLowerCase())
      ),
    [workspaceEntries, query]
  );
  const folders = useMemo(
    () => workspaceFolderPaths(workspaceEntries.map((file) => file.path)),
    [workspaceEntries]
  );
  const treeRows = useMemo(() => {
    const rows: Array<
      | { type: 'folder'; path: string; depth: number }
      | { type: 'file'; file: (typeof workspaceEntries)[number]; depth: number }
    > = [];
    const normalizedQuery = query.toLocaleLowerCase();
    const addChildren = (parent: string, depth: number) => {
      for (const folder of folders.filter((path) => workspaceParentFolder(path) === parent)) {
        const matches =
          !normalizedQuery ||
          folder.toLocaleLowerCase().includes(normalizedQuery) ||
          visibleFiles.some((file) => file.path.startsWith(`${folder}/`));
        if (!matches) continue;
        rows.push({ type: 'folder', path: folder, depth });
        if (normalizedQuery || expandedFolders.has(folder)) addChildren(folder, depth + 1);
      }
      for (const file of visibleFiles
        .filter((entry) => workspaceParentFolder(entry.path) === parent)
        .sort((a, b) =>
          displayWorkspacePath(a.path).localeCompare(displayWorkspacePath(b.path), 'zh-CN')
        )) {
        rows.push({ type: 'file', file, depth });
      }
    };
    addChildren('', 0);
    return rows;
  }, [expandedFolders, folders, query, visibleFiles]);
  const toggleFolder = (folder: string) =>
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  const isDesktop = runtimeMode === 'desktop';
  const activateWorkspaceFile = async (path: string, name: string) => {
    if (onBeforeOpenFile && !(await onBeforeOpenFile(path, name))) return;
    onActivateWorkspace?.();
    await openFile(path);
  };

  return (
    <aside className={styles.sidebar} aria-label={t('files')}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>{t('recent')}</span>
          <strong> {workspace?.name ?? (isDesktop ? t('noWorkspace') : 'A2UI-Terminal')}</strong>
        </div>
        <Tag className={styles.workspaceBadge}>{isDesktop ? t('realWorkspace') : 'Mock'}</Tag>
      </div>
      {currentResultTitle && (
        <div className={styles.currentResultContext}>
          <span>{locale === 'zh-CN' ? '当前成果' : 'Current result'}</span>
          <strong title={currentResultTitle}>{currentResultTitle}</strong>
        </div>
      )}
      <div className={styles.workspaceActions}>
        <div className={styles.primaryActions}>
          <Button
            block
            type="text"
            icon={<FolderOpenOutlined />}
            loading={workspaceLoading}
            onClick={() => void selectWorkspace()}
          >
            {t('openFolder')}
          </Button>
          <Button
            block
            type="text"
            icon={<PaperClipOutlined />}
            loading={workspaceLoading || importLoading}
            onClick={() => void selectImportSources(workspace?.id)}
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
                title: item.name,
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
                <Button
                  type="text"
                  className={styles.removeButton}
                  aria-label={t('removeWorkspace')}
                  icon={<DeleteOutlined />}
                />
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
      {recoveryDraftSummaries.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={t('recoveryDraftsFound').replace('{count}', String(recoveryDraftSummaries.length))}
          description={
            <div className={styles.recoveryList}>
              {recoveryDraftSummaries.slice(0, 5).map((draft) => (
                <div key={draft.relativePath} className={styles.recoveryItem}>
                  <Button
                    type="link"
                    size="small"
                    disabled={!draft.available}
                    onClick={() =>
                      void activateWorkspaceFile(draft.relativePath, draft.relativePath)
                    }
                  >
                    {displayWorkspacePath(draft.relativePath)}
                  </Button>
                  {!draft.available ? <span>{t('recoveryFileUnavailable')}</span> : null}
                  <Popconfirm
                    title={t('discardDraft')}
                    onConfirm={() => void discardRecoveryDraft(draft.relativePath)}
                  >
                    <Button type="text" size="small" danger>
                      {t('discardDraft')}
                    </Button>
                  </Popconfirm>
                </div>
              ))}
            </div>
          }
        />
      ) : null}
      {currentResultTitle && (
        <span className={styles.fileSectionLabel}>
          {locale === 'zh-CN' ? '工作区文件' : 'Workspace files'}
        </span>
      )}
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
          {treeRows.map((row) => {
            if (row.type === 'folder')
              return (
                <Dropdown
                  key={`folder:${row.path}`}
                  trigger={['contextMenu']}
                  menu={{
                    items: [{ key: 'canvas', label: '打开画布', icon: <LayoutOutlined /> }],
                    onClick: () => onOpenCanvas?.(row.path, 'folder'),
                  }}
                >
                  <div className={styles.folderRow} style={{ paddingLeft: row.depth * 14 }}>
                    <button
                      type="button"
                      role="treeitem"
                      aria-expanded={query ? true : expandedFolders.has(row.path)}
                      aria-label={`文件夹 ${row.path}`}
                      className={styles.file}
                      onClick={() => toggleFolder(row.path)}
                    >
                      {query || expandedFolders.has(row.path) ? (
                        <DownOutlined />
                      ) : (
                        <RightOutlined />
                      )}
                      <FolderOutlined />
                      <span>{row.path.split('/').at(-1)}</span>
                    </button>
                    {expandedFolders.has(row.path) && (
                      <Tooltip title={`打开「${row.path}」的画布`}>
                        <Button
                          type="text"
                          size="small"
                          aria-label={`打开文件夹 ${row.path} 的画布`}
                          icon={<LayoutOutlined />}
                          onClick={() => onOpenCanvas?.(row.path, 'folder')}
                        />
                      </Tooltip>
                    )}
                  </div>
                </Dropdown>
              );
            const file = row.file;
            return (
              <Dropdown
                key={file.path}
                trigger={['contextMenu']}
                menu={{
                  items: [
                    { key: 'add', label: t('addToConversation') },
                    { key: 'canvas', label: '打开画布', icon: <LayoutOutlined /> },
                  ],
                  onClick: async ({ key }) => {
                    if (key === 'canvas') {
                      onOpenCanvas?.(file.path, 'file');
                      return;
                    }
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
                        : displayWorkspacePath(file.path)
                      : t('fileCannotOpen')
                  }
                  placement="right"
                >
                  <button
                    type="button"
                    role="treeitem"
                    aria-selected={highlightActiveFile && activePath === file.path}
                    aria-disabled={!file.readable}
                    disabled={!file.readable}
                    className={`${styles.file} ${highlightActiveFile && activePath === file.path ? styles.active : ''}`}
                    style={{ paddingLeft: 10 + row.depth * 14 }}
                    onClick={() => void activateWorkspaceFile(file.path, file.name)}
                  >
                    {iconFor(file.path)}
                    <span>{row.depth ? file.name : displayWorkspacePath(file.path)}</span>
                    {recoveryDraftSummaries.some((draft) => draft.relativePath === file.path) ? (
                      <span className={styles.recoveryDot} aria-label={t('pendingDraftTitle')} />
                    ) : null}
                  </button>
                </Tooltip>
              </Dropdown>
            );
          })}
        </div>
      </Spin>
      <div className={styles.footer}>
        <InfoCircleOutlined aria-hidden="true" />
        <span>{isDesktop ? t('controlledAccess') : t('webOnly')}</span>
      </div>
    </aside>
  );
}
