import { LocatorUpgrade } from '../citation/LocatorUpgrade';
import {
  FileExcelOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileWordOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { isWebMock } from '../../shared/platform/runtime';
import type { ImportBatch, ImportDropOutcome } from '../../shared/types/domain';
import type { KnowledgeDocument, KnowledgeSource } from '../../shared/types/knowledge';
import type { ContextSelection } from '../../shared/types/domain';
import { errorDetails } from '../../stores/support';
import { useAppStore } from '../../stores/useAppStore';
import { importController } from '../imports/importController';
import { useImportDropTarget } from '../imports/useImportDropTarget';
import { knowledgeController as api } from './knowledgeController';
import styles from './KnowledgePage.module.css';
import { ContextPackSettings } from '../contextPacks/components/ContextPackSettings';
import { useImportStore } from '../imports/importStore';

const sourceDate = (value: string, locale: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? `${locale === 'zh-CN' ? '今天' : 'Today'} ${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)}`
    : new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(
        date
      );
};

const sourceStatus = (status: KnowledgeSource['status'], zh: boolean) =>
  status === 'ready'
    ? zh
      ? '可检索'
      : 'Searchable'
    : status === 'deleting'
      ? zh
        ? '待清理'
        : 'Pending cleanup'
      : zh
        ? '不可用'
        : 'Unavailable';

const indexStatus = (status: KnowledgeSource['status'], zh: boolean) =>
  status === 'ready' ? (zh ? '已索引' : 'Indexed') : sourceStatus(status, zh);

const sourceIcon = (format: string) => {
  switch (format.toLowerCase()) {
    case 'pdf':
      return <FilePdfOutlined aria-hidden="true" />;
    case 'docx':
      return <FileWordOutlined aria-hidden="true" />;
    case 'md':
      return <FileMarkdownOutlined aria-hidden="true" />;
    case 'xlsx':
    case 'csv':
      return <FileExcelOutlined aria-hidden="true" />;
    default:
      return <FileTextOutlined aria-hidden="true" />;
  }
};

const formatLabel = (format: string) => {
  switch (format.toLowerCase()) {
    case 'md':
      return 'Markdown';
    case 'docx':
      return 'Word';
    case 'xlsx':
      return 'Excel';
    default:
      return format.toUpperCase();
  }
};

export function KnowledgePage() {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [tab, setTab] = useState(() =>
    window.location.hash.includes('tab=packs') ? 'packs' : 'sources'
  );
  useEffect(() => {
    const sync = () => setTab(window.location.hash.includes('tab=packs') ? 'packs' : 'sources');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return (
    <section className={styles.page} aria-label={zh ? '资料库' : 'Library'}>
      <h1>{zh ? '资料库' : 'Library'}</h1>
      <p className={styles.pageSubtitle}>
        {zh ? '保存并复用你的长期资料' : 'Keep and reuse your long-term sources'}
      </p>
      <LocatorUpgrade />
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key);
          window.location.hash = key === 'packs' ? '/knowledge?tab=packs' : '/knowledge';
        }}
        destroyOnHidden
        items={[
          {
            key: 'sources',
            label: zh ? '我的资料' : 'My sources',
            children: <KnowledgeSources />,
          },
          { key: 'packs', label: zh ? '资料包' : 'Packs', children: <ContextPackSettings /> },
        ]}
      />
    </section>
  );
}

function KnowledgeSources() {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const currentWorkspace = useAppStore((state) => state.workspace);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const forgetAuthorizedSource = useAppStore((state) => state.forgetAuthorizedSource);
  const authorizedSources = useImportStore((state) => state.sources);
  const sourceError = useImportStore((state) => state.error);
  const revokingSourceId = useImportStore((state) => state.revokingSourceId);
  const loadAuthorizedSources = useImportStore((state) => state.loadSources);
  const revokeAuthorizedSource = useImportStore((state) => state.revokeSource);
  const [items, setItems] = useState<KnowledgeSource[]>([]);
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState('all');
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [preview, setPreview] = useState<KnowledgeDocument | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<KnowledgeSource | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<(typeof authorizedSources)[number] | null>(null);
  const [mockFiles, setMockFiles] = useState<File[]>([]);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef({ value: 0 });
  const previewRequest = useRef({ value: 0 });
  const mockImportInput = useRef<HTMLInputElement>(null);
  const report = useCallback((e: unknown) => setError(errorDetails(e).message), []);
  const receive = useCallback((outcome: ImportDropOutcome) => {
    if (outcome.batch) {
      setBatch(outcome.batch);
      setAccepted([]);
    } else setError(outcome.errorMessage ?? 'Import failed');
  }, []);
  const dropRef = useImportDropTarget(undefined, undefined, receive);

  useEffect(() => {
    const requests = generation.current;
    const previews = previewRequest.current;
    const current = ++requests.value;
    void api
      .list({ query })
      .then((page) => {
        if (current !== generation.current.value) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((e) => {
        if (current === generation.current.value) report(e);
      })
      .finally(() => {
        if (current === generation.current.value) setBusy(false);
      });
    return () => {
      requests.value++;
      previews.value++;
    };
  }, [query, refresh, report]);

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setRefresh((n) => n + 1);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const chooseSources = () => {
    if (isWebMock()) {
      mockImportInput.current?.click();
      return;
    }
    void perform(async () => {
      const selected = await importController.select();
      if (selected) {
        setBatch(selected);
        setAccepted([]);
      }
    });
  };
  const open = async (id: string, expandPreview = false) => {
    const ticket = ++previewRequest.current.value;
    try {
      const d = await api.get(id);
      if (ticket !== previewRequest.current.value) return;
      setPreview(d);
      setTitle(d.source.title);
      setTags(d.source.tags);
      setPreviewExpanded(expandPreview);
      setEditing(false);
      return true;
    } catch (e) {
      if (ticket === previewRequest.current.value) report(e);
      return false;
    }
  };
  useEffect(() => {
    const id = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id');
    let disposed = false;
    if (id)
      void api
        .get(id)
        .then((d) => {
          if (!disposed) {
            setPreview(d);
            setTitle(d.source.title);
            setTags(d.source.tags);
            setPreviewExpanded(true);
            setEditing(false);
          }
        })
        .catch((e) => {
          if (!disposed) report(e);
        });
    return () => {
      disposed = true;
    };
  }, [report]);

  const addSourceToCurrentTask = (sourceId: string) => {
    const state = useAppStore.getState();
    if (!state.workspace || !state.activeSessionId) return;
    const current: ContextSelection = state.contextBySession[state.activeSessionId] ?? {
      selection: false,
      currentFile: false,
      recentMessages: false,
      recentMessageCount: 3,
      projectFiles: [],
    };
    state.setSessionContext(state.activeSessionId, {
      ...current,
      personalKnowledgeIds: [...new Set([...(current.personalKnowledgeIds ?? []), sourceId])],
    });
    state.setSessionContextReviewKey(state.activeSessionId, 'library-selection-needs-review');
    window.location.hash = '/workbench';
  };

  const showFormatFilters = items.length >= 10 || formatFilter !== 'all';
  const visibleItems =
    formatFilter === 'all'
      ? items
      : items.filter((item) =>
          formatFilter === 'spreadsheet'
            ? ['csv', 'xlsx'].includes(item.format.toLowerCase())
            : item.format.toLowerCase() === formatFilter
        );
  const previewLinkedSource = authorizedSources.find(
    (source) =>
      source.workspaceId === currentWorkspace?.id && source.contentHash === preview?.source.rawHash
  );

  const toolbar = (
    <div className={styles.sourceToolbar}>
      <Input.Search
        className={styles.sourceSearch}
        aria-label={zh ? '搜索资料库' : 'Search library'}
        placeholder={zh ? '搜索名称、标签或正文' : 'Search name, tags or content'}
        maxLength={200}
        onSearch={(value) => {
          generation.current.value++;
          setBusy(true);
          setError(null);
          setQuery(value);
          setRefresh((n) => n + 1);
        }}
        allowClear
      />
      {isWebMock() ? (
        <label className={styles.mockImport}>
          <PlusOutlined aria-hidden="true" />
          {zh ? '导入资料' : 'Import sources'}
          <input
            type="file"
            ref={mockImportInput}
            accept=".txt,.md"
            multiple
            disabled={busy}
            aria-label={zh ? '导入资料' : 'Import sources'}
            onChange={(e) => {
              setMockFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </label>
      ) : (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          aria-label={zh ? '导入资料' : 'Import sources'}
          disabled={busy}
          onClick={chooseSources}
        >
          {zh ? '导入资料' : 'Import sources'}
        </Button>
      )}
      <Tooltip title={zh ? '刷新资料列表' : 'Refresh sources'}>
        <Button
          aria-label={zh ? '刷新资料列表' : 'Refresh sources'}
          icon={<ReloadOutlined />}
          className={styles.refreshButton}
          size="small"
          type="text"
          disabled={busy}
          onClick={() => setRefresh((n) => n + 1)}
        />
      </Tooltip>
    </div>
  );

  return (
    <section
      className={styles.sourcesSection}
      ref={dropRef}
      aria-label={zh ? '个人资料库' : 'Personal library'}
    >
      {toolbar}
      <div className={styles.privacyHint}>
        <InfoCircleOutlined aria-hidden="true" />
        <span>
          {zh
            ? '本地保存 · 使用资料前仍由你确认发送范围'
            : 'Saved locally · You confirm the send scope before use'}
        </span>
        <Tooltip
          title={
            zh
              ? '使用资料时仍需选择并确认发送范围。支持 TXT、MD、DOCX、PDF、CSV、XLSX；扫描 PDF 暂不支持 OCR。'
              : 'Select and confirm the send scope before AI use. TXT, MD, DOCX, PDF, CSV and XLSX are supported; scanned PDFs need OCR.'
          }
        >
          <Button type="link" size="small" aria-label={zh ? '了解更多' : 'Learn more'}>
            {zh ? '了解更多' : 'Learn more'}
          </Button>
        </Tooltip>
      </div>
      {error && <Alert type="error" showIcon title={error} />}
      {sourceError && <Alert type="error" showIcon title={sourceError} />}
      {busy && <Spin />}
      {!busy && items.length === 0 && (
        <div className={styles.emptySources} data-testid="knowledge-empty">
          <Empty description={zh ? '还没有资料' : 'No sources yet'} />
          <p>
            {zh
              ? '导入后可以跨工作区复用，使用前仍会由你确认发送范围。'
              : 'Reuse imported sources across workspaces. You still confirm what AI can receive.'}
          </p>
        </div>
      )}
      {showFormatFilters && (
        <div
          className={styles.formatFilters}
          role="group"
          aria-label={zh ? '资料类型' : 'Source type'}
        >
          {[
            ['all', zh ? '全部' : 'All'],
            ['pdf', 'PDF'],
            ['docx', 'Word'],
            ['md', 'Markdown'],
            ['spreadsheet', zh ? '表格' : 'Spreadsheet'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={formatFilter === key ? styles.filterActive : undefined}
              aria-pressed={formatFilter === key}
              onClick={() => setFormatFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {items.length > 0 && visibleItems.length === 0 && (
        <div className={styles.filterEmpty}>
          {zh ? '这一类型暂无资料' : 'No sources of this type'}
        </div>
      )}
      <ul className={styles.list}>
        {visibleItems.map((item) => {
          const linkedSource = authorizedSources.find(
            (source) =>
              source.workspaceId === currentWorkspace?.id && source.contentHash === item.rawHash
          );
          return (
            <li
              key={item.id}
              className={styles.sourceRow}
              onClick={(event) => {
                if (
                  item.status === 'ready' &&
                  event.currentTarget.contains(event.target as Node) &&
                  !(event.target as Element).closest('button')
                )
                  void open(item.id);
              }}
            >
              <div className={styles.sourceIdentity}>
                <span
                  className={`${styles.sourceIcon} ${styles[`format_${item.format.toLowerCase()}`] ?? ''}`}
                >
                  {sourceIcon(item.format)}
                </span>
                <div>
                  <Button
                    type="link"
                    disabled={item.status !== 'ready'}
                    onClick={() => void open(item.id)}
                  >
                    {item.title}
                  </Button>
                  {item.title !== item.originalName && (
                    <span className={styles.sourceOriginal}>{item.originalName}</span>
                  )}
                  <span className={styles.sourceMeta}>
                    <span className={styles.typeBadge}>{formatLabel(item.format)}</span>
                    <span>{sourceDate(item.updatedAt, locale)}</span>
                    <span>{sourceStatus(item.status, zh)}</span>
                    {item.tags.length > 0 && (
                      <span className={styles.sourceTags}>
                        {item.tags.map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </span>
                    )}
                  </span>
                </div>
              </div>
              <div className={styles.sourceActions}>
                <Dropdown
                  trigger={['click']}
                  onOpenChange={(openMenu) => {
                    if (openMenu && currentWorkspace?.id)
                      void loadAuthorizedSources(currentWorkspace.id);
                  }}
                  menu={{
                    items: [
                      {
                        key: 'details',
                        label: zh ? '查看详情' : 'View details',
                        disabled: item.status !== 'ready',
                      },
                      {
                        key: 'preview',
                        label: zh ? '预览' : 'Preview',
                        disabled: item.status !== 'ready',
                      },
                      {
                        key: 'rename',
                        label: zh ? '重命名' : 'Rename',
                        disabled: item.status !== 'ready',
                      },
                      {
                        key: 'tags',
                        label: zh ? '管理标签' : 'Manage tags',
                        disabled: item.status !== 'ready',
                      },
                      {
                        key: 'use',
                        label: zh ? '用于当前任务' : 'Use in current task',
                        disabled: item.status !== 'ready' || !currentWorkspace || !activeSessionId,
                      },
                      ...(linkedSource
                        ? [
                            {
                              key: 'revoke',
                              label: zh ? '从当前工作区移除' : 'Remove from workspace',
                            },
                          ]
                        : []),
                      { type: 'divider' },
                      {
                        key: 'delete',
                        label: zh ? '从资料库删除' : 'Delete from library',
                        danger: true,
                      },
                    ],
                    onClick: ({ key }) => {
                      if (key === 'delete') setDeleting(item);
                      else if (key === 'revoke' && linkedSource) setRevokeTarget(linkedSource);
                      else if (key === 'use') addSourceToCurrentTask(item.id);
                      else
                        void open(item.id, key === 'preview').then((loaded) => {
                          if (loaded && (key === 'rename' || key === 'tags')) setEditing(true);
                        });
                    },
                  }}
                >
                  <Button
                    aria-label={`${zh ? '资料操作' : 'Source actions'}：${item.title}`}
                    icon={<MoreOutlined />}
                    disabled={busy}
                  />
                </Dropdown>
              </div>
            </li>
          );
        })}
      </ul>
      {cursor !== null && (
        <Button
          disabled={busy}
          onClick={() => {
            const current = generation.current.value;
            setBusy(true);
            void api
              .list({ query, after: cursor })
              .then((page) => {
                if (current === generation.current.value) {
                  setItems((v) => [...v, ...page.items]);
                  setCursor(page.nextCursor);
                }
              })
              .catch(report)
              .finally(() => {
                if (current === generation.current.value) setBusy(false);
              });
          }}
        >
          {zh ? '加载更多' : 'Load more'}
        </Button>
      )}
      <Modal
        open={Boolean(batch)}
        okText={zh ? '确认导入' : 'Confirm import'}
        cancelText={zh ? '取消' : 'Cancel'}
        title={zh ? '确认存入个人资料库' : 'Confirm local import'}
        confirmLoading={busy}
        okButtonProps={{ disabled: !batch?.canConfirm || accepted.length === 0 }}
        onOk={() =>
          void perform(async () => {
            if (!batch) return;
            const b = batch;
            setBatch(null);
            await api.confirm(b.id, accepted, true);
          })
        }
        onCancel={() => {
          if (busy) return;
          const b = batch;
          setBatch(null);
          if (b) void perform(() => api.confirm(b.id, [], false));
        }}
      >
        <p>
          {zh
            ? '仅复制勾选资料；相同内容自动复用已有记录。原文件不会被修改。'
            : 'Copy selected sources only. Identical content reuses an existing record. Original files remain unchanged.'}
        </p>
        {batch?.items.map((item) => (
          <div key={item.id}>
            <Checkbox
              checked={accepted.includes(item.id)}
              disabled={
                item.status !== 'ready' ||
                !['txt', 'md', 'pdf', 'docx', 'csv', 'xlsx'].includes(item.extension)
              }
              onChange={(e) =>
                setAccepted((v) =>
                  e.target.checked ? [...v, item.id] : v.filter((id) => id !== item.id)
                )
              }
            >
              {item.name}
            </Checkbox>
            <p>{item.reason ?? item.warnings.join(' · ')}</p>
          </div>
        ))}
        {batch?.failureReason && <Alert type="error" title={batch.failureReason} />}
      </Modal>
      <Modal
        open={mockFiles.length > 0}
        okText={zh ? '确认导入' : 'Confirm import'}
        cancelText={zh ? '取消' : 'Cancel'}
        title={zh ? '确认本地导入（Web Mock）' : 'Confirm local import (Web Mock)'}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setMockFiles([]);
        }}
        onOk={() =>
          void perform(async () => {
            await api.importMock(mockFiles);
            setMockFiles([]);
          })
        }
      >
        {mockFiles.map((f, i) => (
          <p key={i}>{f.name}</p>
        ))}
      </Modal>
      <Drawer
        open={Boolean(preview)}
        size={440}
        rootClassName={styles.detailDrawer}
        title={zh ? '资料详情' : 'Source details'}
        onClose={() => {
          previewRequest.current.value++;
          setPreview(null);
        }}
      >
        {preview && (
          <div className={styles.details}>
            <div className={styles.detailIdentity}>
              <span
                className={`${styles.sourceIcon} ${styles[`format_${preview.source.format.toLowerCase()}`] ?? ''}`}
              >
                {sourceIcon(preview.source.format)}
              </span>
              <div>
                <strong>{preview.source.title}</strong>
                <span className={styles.detailIdentityMeta}>
                  {formatLabel(preview.source.format)} · {zh ? '个人资料库' : 'Personal library'} ·
                  <span
                    className={`${styles.indexBadge} ${preview.source.status === 'ready' ? styles.indexReady : ''}`}
                  >
                    <span aria-hidden="true" className={styles.statusDot} />
                    {indexStatus(preview.source.status, zh)}
                  </span>
                </span>
              </div>
            </div>
            <div className={styles.detailActions}>
              <Tooltip
                title={
                  !currentWorkspace || !activeSessionId
                    ? zh
                      ? '请先打开工作区会话'
                      : 'Open a workspace conversation first'
                    : undefined
                }
              >
                <Button
                  type="primary"
                  disabled={!currentWorkspace || !activeSessionId}
                  onClick={() => addSourceToCurrentTask(preview.source.id)}
                >
                  {zh ? '用于当前任务' : 'Use in current task'}
                </Button>
              </Tooltip>
              <Button
                aria-label={
                  previewExpanded ? (zh ? '收起预览' : 'Hide preview') : zh ? '预览' : 'Preview'
                }
                onClick={() => setPreviewExpanded((value) => !value)}
              >
                {previewExpanded ? (zh ? '收起预览' : 'Hide preview') : zh ? '预览' : 'Preview'}
              </Button>
              <Button type="text" onClick={() => setEditing((value) => !value)}>
                {zh ? '编辑信息' : 'Edit info'}
              </Button>
              <Dropdown
                trigger={['click']}
                getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
                onOpenChange={(openMenu) => {
                  if (openMenu && currentWorkspace?.id)
                    void loadAuthorizedSources(currentWorkspace.id);
                }}
                menu={{
                  items: [
                    { key: 'rename', label: zh ? '重命名' : 'Rename' },
                    ...(previewLinkedSource
                      ? [
                          {
                            key: 'revoke',
                            label: zh ? '从当前工作区移除' : 'Remove from workspace',
                          },
                        ]
                      : []),
                    { type: 'divider' },
                    {
                      key: 'delete',
                      label: zh ? '从资料库删除' : 'Delete from library',
                      danger: true,
                    },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'rename') setEditing(true);
                    else if (key === 'revoke' && previewLinkedSource) {
                      setPreview(null);
                      setRevokeTarget(previewLinkedSource);
                    } else if (key === 'delete') {
                      setPreview(null);
                      setDeleting(preview.source);
                    }
                  },
                }}
              >
                <Button
                  type="text"
                  icon={<MoreOutlined />}
                  aria-label={zh ? '更多资料操作' : 'More source actions'}
                  title={zh ? '更多资料操作' : 'More source actions'}
                />
              </Dropdown>
            </div>
            <section
              className={styles.detailGroup}
              aria-label={zh ? '基本信息' : 'Basic information'}
            >
              <h3>{zh ? '基本信息' : 'Basic information'}</h3>
              <dl className={styles.detailFacts}>
                <dt>{zh ? '类型' : 'Type'}</dt>
                <dd>{formatLabel(preview.source.format)}</dd>
                <dt>{zh ? '来源' : 'Source'}</dt>
                <dd>{zh ? '个人资料库' : 'Personal library'}</dd>
                <dt>{zh ? '原文件' : 'Original file'}</dt>
                <dd>{preview.source.originalName}</dd>
              </dl>
            </section>
            <section
              className={styles.detailGroup}
              aria-label={zh ? '状态信息' : 'Status information'}
            >
              <h3>{zh ? '状态' : 'Status'}</h3>
              <dl className={styles.detailFacts}>
                <dt>{zh ? '索引状态' : 'Index status'}</dt>
                <dd>
                  <span
                    className={`${styles.indexBadge} ${preview.source.status === 'ready' ? styles.indexReady : ''}`}
                  >
                    <span aria-hidden="true" className={styles.statusDot} />
                    {indexStatus(preview.source.status, zh)}
                  </span>
                </dd>
                <dt>{zh ? '导入时间' : 'Imported'}</dt>
                <dd>{sourceDate(preview.source.createdAt, locale)}</dd>
                <dt>{zh ? '更新时间' : 'Updated'}</dt>
                <dd>{sourceDate(preview.source.updatedAt, locale)}</dd>
              </dl>
            </section>
            <section
              className={styles.detailGroup}
              aria-label={zh ? '标签信息' : 'Tags information'}
            >
              <h3>{zh ? '标签' : 'Tags'}</h3>
              <div className={styles.detailTags}>
                {preview.source.tags.length ? (
                  preview.source.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)
                ) : (
                  <span className={styles.noTags}>{zh ? '暂无标签' : 'No tags'}</span>
                )}
                <Button
                  type="link"
                  size="small"
                  icon={<PlusOutlined />}
                  aria-label={zh ? '添加标签' : 'Add tag'}
                  onClick={() => setEditing(true)}
                >
                  {zh ? '添加标签' : 'Add tag'}
                </Button>
              </div>
            </section>
            {editing && (
              <div className={styles.detailEditor}>
                <Input
                  aria-label={zh ? '资料名称' : 'Source title'}
                  value={title}
                  maxLength={160}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <Select
                  mode="tags"
                  aria-label={zh ? '标签' : 'Tags'}
                  value={tags}
                  onChange={setTags}
                  className={styles.tags}
                  maxCount={20}
                />
                <Button
                  type="primary"
                  loading={busy}
                  disabled={!title.trim()}
                  onClick={() =>
                    void perform(async () => {
                      await api.edit({ id: preview.source.id, title, tags });
                      setPreview(null);
                    })
                  }
                >
                  {zh ? '保存名称和标签' : 'Save title and tags'}
                </Button>
              </div>
            )}
            {previewExpanded && (
              <div className={styles.previewSection}>
                <h3>{zh ? '提取正文预览' : 'Extracted text preview'}</h3>
                <p>
                  {zh
                    ? '预览仅显示本地提取内容，不会发送给 AI。'
                    : 'This local preview is not sent to AI.'}
                </p>
                <pre className={styles.preview}>
                  {preview.parsed.blocks.map((b) => b.text).join('\n')}
                </pre>
              </div>
            )}
          </div>
        )}
      </Drawer>
      <Modal
        open={Boolean(revokeTarget)}
        title={
          revokeTarget
            ? `${zh ? '从当前工作区移除' : 'Remove from workspace'}：${revokeTarget.name}`
            : ''
        }
        okText={zh ? '从工作区移除' : 'Remove from workspace'}
        cancelText={zh ? '取消' : 'Cancel'}
        okButtonProps={{ danger: true, loading: Boolean(revokingSourceId) }}
        onCancel={() => setRevokeTarget(null)}
        onOk={async () => {
          if (!revokeTarget || !currentWorkspace) return;
          if (await revokeAuthorizedSource(currentWorkspace.id, revokeTarget.id)) {
            forgetAuthorizedSource(revokeTarget.id);
            setRevokeTarget(null);
          }
        }}
      >
        <p>
          {zh
            ? '只取消当前工作区的授权；个人资料库中的副本和原文件不会删除。'
            : 'Only workspace authorization is removed. The library copy and original file are preserved.'}
        </p>
      </Modal>
      <Modal
        open={Boolean(deleting)}
        okText={zh ? '确认删除' : 'Confirm delete'}
        cancelText={zh ? '取消' : 'Cancel'}
        title={zh ? '删除资料副本？' : 'Delete managed source?'}
        confirmLoading={busy}
        okButtonProps={{ danger: true }}
        onCancel={() => {
          if (!busy) setDeleting(null);
        }}
        onOk={() =>
          void perform(async () => {
            if (deleting) await api.delete(deleting.id);
            setDeleting(null);
            setPreview(null);
          })
        }
      >
        {zh
          ? '原文件和成果不会删除。正在进行的 AI 请求将停止。已发送给模型的内容无法撤回，已有成果和聊天中的摘录不会被自动改写。'
          : 'Original files and results are preserved. Active AI requests will stop. Previously sent data cannot be recalled; excerpts already in results or chats remain.'}
      </Modal>
    </section>
  );
}
