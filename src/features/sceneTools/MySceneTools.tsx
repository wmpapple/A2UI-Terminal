import { EllipsisOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, Button, Dropdown, Empty, Input, Modal, Spin } from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import type { SceneToolListItem } from '../../shared/types/sceneTool';
import { useAppStore } from '../../stores/useAppStore';
import { sceneToolController } from './sceneToolController';
import { sceneTools, useSceneToolStore } from './sceneToolStore';
import styles from './SceneTools.module.css';

export type SceneToolManageAction = 'rename' | 'binding' | 'template';
type ToolFilter = 'all' | 'linked' | 'unlinked' | 'published';

export function MySceneTools({
  onOpenResult,
  activeId,
  onCreate,
  onDeleted,
  onManage,
}: {
  onOpenResult: (id: string) => void;
  activeId?: string | null;
  onCreate?: () => void;
  onDeleted?: (id: string) => void;
  onManage?: (id: string, action: SceneToolManageAction) => void;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const mode = useAppStore((s) => s.runtimeMode);
  const liveEntries = useSceneToolStore((s) => s.entries);
  const [items, setItems] = useState<SceneToolListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ToolFilter>('all');
  const [deleteTarget, setDeleteTarget] = useState<SceneToolListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const when = (value: string) => {
    const date = new Date(value);
    const now = new Date();
    if (date.toDateString() === now.toDateString())
      return `${zh ? '今天' : 'Today'} ${date.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    return date.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
  };
  useEffect(() => {
    if (mode !== 'desktop') return;
    let active = true;
    let sequence = 0;
    const reload = () => {
      const request = ++sequence;
      void sceneToolController
        .list()
        .then((rows) => {
          if (active && request === sequence) {
            setItems(rows);
            setError(null);
          }
        })
        .catch((reason: unknown) => {
          if (active && request === sequence)
            setError(
              reason && typeof reason === 'object' && 'message' in reason
                ? String(reason.message)
                : String(reason)
            );
        });
    };
    reload();
    window.addEventListener('scene-tool-list-changed', reload);
    window.addEventListener('focus', reload);
    return () => {
      active = false;
      window.removeEventListener('scene-tool-list-changed', reload);
      window.removeEventListener('focus', reload);
    };
  }, [mode, activeId]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return (items ?? []).filter((item) => {
      if (filter === 'linked' && !item.bindingTitle) return false;
      if (filter === 'unlinked' && item.bindingTitle) return false;
      if (filter === 'published' && !item.publication) return false;
      if (!needle) return true;
      return [item.title, item.bindingTitle, item.publication?.title]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase(locale).includes(needle));
    });
  }, [filter, items, locale, query]);

  const filters: Array<[ToolFilter, string]> = [
    ['all', zh ? '全部' : 'All'],
    ['linked', zh ? '已关联' : 'Linked'],
    ['unlinked', zh ? '未关联' : 'Unlinked'],
    ['published', zh ? '已有成果' : 'Has result'],
  ];
  const filterCounts = useMemo<Record<ToolFilter, number>>(
    () => ({
      all: items?.length ?? 0,
      linked: items?.filter((item) => Boolean(item.bindingTitle)).length ?? 0,
      unlinked: items?.filter((item) => !item.bindingTitle).length ?? 0,
      published: items?.filter((item) => Boolean(item.publication)).length ?? 0,
    }),
    [items]
  );

  const manage = (item: SceneToolListItem, action: SceneToolManageAction) => {
    onOpenResult(item.id);
    onManage?.(item.id, action);
  };

  const menu = (item: SceneToolListItem): MenuProps => ({
    items: [
      { key: 'template', label: zh ? '保存为个人模板' : 'Save as personal template' },
      { key: 'rename', label: zh ? '重命名' : 'Rename' },
      {
        key: 'binding',
        label: item.bindingTitle
          ? zh
            ? '更换关联对象'
            : 'Change linked target'
          : zh
            ? '关联对象'
            : 'Link target',
      },
      { type: 'divider' },
      { key: 'delete', label: zh ? '删除工具' : 'Delete tool', danger: true },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'delete') setDeleteTarget(item);
      else manage(item, key as SceneToolManageAction);
    },
  });

  if (mode !== 'desktop') return null;
  return (
    <section className={styles.myToolsPanel} aria-label={zh ? '我的工具' : 'My Tools'}>
      <h2>
        {zh ? '我的工具' : 'My Tools'}
        <span className={styles.toolCount}>{items?.length ?? 0}</span>
      </h2>
      {onCreate ? (
        <Button
          type={items?.length === 0 ? 'primary' : 'default'}
          className={styles.createToolButton}
          onClick={onCreate}
        >
          {zh ? '+ 新建工具' : '+ New tool'}
        </Button>
      ) : null}
      <Input
        allowClear
        prefix={<SearchOutlined />}
        className={styles.toolSearch}
        aria-label={zh ? '搜索工具' : 'Search tools'}
        placeholder={zh ? '搜索工具…' : 'Search tools…'}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div
        className={styles.toolFilters}
        role="group"
        aria-label={zh ? '筛选工具' : 'Filter tools'}
      >
        {filters.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            <span>{label}</span>
            <small>{filterCounts[key]}</small>
          </button>
        ))}
      </div>
      {error ? (
        <Alert type="error" title={error} />
      ) : items === null ? (
        <Spin />
      ) : items.length === 0 ? (
        <Empty description={zh ? '还没有使用过的工具' : 'No tools yet'} />
      ) : visibleItems.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={zh ? '没有符合条件的工具' : 'No matching tools'}
        />
      ) : (
        <ul className={styles.toolList}>
          {visibleItems.map((item) => {
            const live = liveEntries[item.id];
            const publicationPending = Boolean(
              item.publication && (!item.publication.synced || live?.dirty || live?.saving)
            );
            const publicationStatus = item.publication
              ? publicationPending
                ? zh
                  ? '成果待更新'
                  : 'Result pending'
                : zh
                  ? `成果 Rev ${item.publication.revisionNumber}`
                  : `Result Rev ${item.publication.revisionNumber}`
              : null;
            const metadata = [
              item.bindingTitle ?? (zh ? '未关联' : 'Unlinked'),
              publicationStatus,
              when(item.updatedAt),
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={item.id} className={styles.toolListItem} data-active={activeId === item.id}>
                <Button
                  aria-label={item.title}
                  type="text"
                  className={styles.toolListMain}
                  onClick={() => onOpenResult(item.id)}
                >
                  <span>
                    <strong>{item.title}</strong>
                    <small>{metadata}</small>
                  </span>
                </Button>
                <Dropdown menu={menu(item)} trigger={['click']}>
                  <Button
                    type="text"
                    className={styles.toolRowMenu}
                    icon={<EllipsisOutlined />}
                    aria-label={`${zh ? '工具操作' : 'Tool actions'}：${item.title}`}
                    onClick={(event) => event.stopPropagation()}
                  />
                </Dropdown>
              </li>
            );
          })}
        </ul>
      )}
      <Modal
        title={
          deleteTarget
            ? zh
              ? `删除工具“${deleteTarget.title}”？`
              : `Delete “${deleteTarget.title}”?`
            : ''
        }
        open={deleteTarget !== null}
        okText={zh ? '删除' : 'Delete'}
        cancelText={zh ? '取消' : 'Cancel'}
        okButtonProps={{ danger: true }}
        confirmLoading={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onOk={async () => {
          if (!deleteTarget || deleting) return;
          setDeleting(true);
          const deleted = await sceneTools.delete(deleteTarget.id);
          setDeleting(false);
          if (deleted) {
            onDeleted?.(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
      >
        {zh
          ? '工具填写状态将被删除；已经手动保存的成果会保留。'
          : 'The tool state will be deleted. Published results are kept.'}
      </Modal>
    </section>
  );
}
