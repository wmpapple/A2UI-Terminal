import {
  FileMarkdownOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Input, Tag, Tooltip } from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import styles from './WorkspaceSidebar.module.css';

const iconFor = (path: string) =>
  path.endsWith('.md') ? <FileMarkdownOutlined /> : <FileTextOutlined />;

export function WorkspaceSidebar() {
  const { t } = useI18n();
  const files = useAppStore((state) => state.files);
  const activePath = useAppStore((state) => state.activePath);
  const openFile = useAppStore((state) => state.openFile);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const addFileToContext = useAppStore((state) => state.addFileToContext);
  const [query, setQuery] = useState('');
  const visibleFiles = useMemo(
    () => files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase())),
    [files, query]
  );

  return (
    <aside className={styles.sidebar} aria-label={t('files')}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>{t('recent')}</span>
          <strong> A2UI-Terminal</strong>
        </div>
        <Tag color="blue">Mock</Tag>
      </div>
      <Button block icon={<FolderOpenOutlined />} className={styles.openButton}>
        {t('openFolder')}
      </Button>
      <Input
        allowClear
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        prefix={<SearchOutlined />}
        placeholder={t('searchFiles')}
      />
      <div className={styles.tree} role="tree">
        {visibleFiles.map((file) => (
          <Dropdown
            key={file.path}
            trigger={['contextMenu']}
            menu={{
              items: [{ key: 'add', label: t('addToConversation') }],
              onClick: () => addFileToContext(activeSessionId, file.path),
            }}
          >
            <button
              type="button"
              role="treeitem"
              aria-selected={activePath === file.path}
              className={`${styles.file} ${activePath === file.path ? styles.active : ''}`}
              onClick={() => openFile(file.path)}
            >
              {iconFor(file.path)}
              <Tooltip title={file.path}>
                <span>{file.path}</span>
              </Tooltip>
            </button>
          </Dropdown>
        ))}
      </div>
      <div className={styles.footer}>{t('webOnly')}</div>
    </aside>
  );
}
