import {
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
  DeleteOutlined,
  RightOutlined,
  FileTextOutlined,
  TableOutlined,
  CheckSquareOutlined,
  FormOutlined,
  ToolOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Alert, Button, Empty, Input, Skeleton, Tag, Modal } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { MessageKey } from '../../../app/i18n/messages';
import type { ResultStatus, ResultType } from '../../../shared/types/domain';
import { resultAdapterDefinitions } from '../resultAdapters';
import { useResultStore } from '../resultStore';
import { lazyFeature } from '../../../app/lazyFeature';
import styles from './ResultsPage.module.css';
import { CollaborationInbox } from '../../collaboration/CollaborationInbox';
import { collaborationController } from '../../collaboration/collaborationController';
import type { CollaborationOverview } from '../../../shared/types/collaboration';
import { isWebMock } from '../../../shared/platform/runtime';
import { userFacingError } from '../../../shared/errors/userFacingError';

const CreateTextResultModal = lazyFeature(async () => {
  const module = await import('./CreateTextResultModal');
  return { default: module.CreateTextResultModal };
});

const PAGE_SIZE = 40;
const resultIcons = {
  document: FileTextOutlined,
  spreadsheet: TableOutlined,
  checklist: CheckSquareOutlined,
  form: FormOutlined,
  tool: ToolOutlined,
} satisfies Record<ResultType, typeof FileTextOutlined>;

interface Props {
  onOpenResult: (resultId: string) => void;
}

const statusLabels: Record<ResultStatus, MessageKey> = {
  draft: 'resultStatusDraft',
  generating: 'resultStatusGenerating',
  review_pending: 'resultStatusReviewPending',
  ready: 'resultStatusReady',
  exporting: 'resultStatusExporting',
  failed: 'resultStatusFailed',
  archived: 'resultStatusArchived',
};

export function ResultsPage({ onOpenResult }: Props) {
  const { t, locale } = useI18n();
  const results = useResultStore((state) => state.results);
  const loading = useResultStore((state) => state.loading);
  const error = useResultStore((state) => state.error);
  const loadResults = useResultStore((state) => state.loadResults);
  const clearError = useResultStore((state) => state.clearError);
  const deleteResult = useResultStore((state) => state.deleteResult);
  const pinResult = useResultStore((state) => state.pinResult);
  const pinningResultIds = useResultStore((state) => state.pinningResultIds);
  const saving = useResultStore((state) => state.saving);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [activeTab, setActiveTab] = useState<'results' | 'inbox'>('results');
  const [resultQuery, setResultQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'document' | 'tool' | 'recent'>('all');
  const [inbox, setInbox] = useState<CollaborationOverview | null>(null);
  const [inboxLoading, setInboxLoading] = useState(!isWebMock());
  const [inboxError, setInboxError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const inboxGeneration = useRef(0);
  const zh = locale === 'zh-CN';
  const filteredResults = results.filter(
    (result) =>
      result.title
        .toLocaleLowerCase(locale)
        .includes(resultQuery.trim().toLocaleLowerCase(locale)) &&
      (resultFilter === 'all' || resultFilter === 'recent' || result.type === resultFilter)
  );
  if (resultFilter === 'recent')
    filteredResults.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filteredResults.length / PAGE_SIZE) - 1)
  );
  const start = currentPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, filteredResults.length);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const changePage = (next: number) => {
    setPage(next);
    heading.current?.scrollIntoView({ block: 'start' });
    heading.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  const refreshInbox = useCallback(async () => {
    if (isWebMock()) return;
    const generation = ++inboxGeneration.current;
    setInboxLoading(true);
    setInboxError('');
    try {
      const next = await collaborationController.overview();
      if (generation === inboxGeneration.current) setInbox(next);
    } catch (cause) {
      if (generation === inboxGeneration.current) setInboxError(userFacingError(cause, locale));
    } finally {
      if (generation === inboxGeneration.current) setInboxLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    if (isWebMock()) return;
    let active = true;
    const generation = ++inboxGeneration.current;
    void collaborationController
      .overview()
      .then((next) => {
        if (active && generation === inboxGeneration.current) setInbox(next);
      })
      .catch((cause) => {
        if (active && generation === inboxGeneration.current)
          setInboxError(userFacingError(cause, locale));
      })
      .finally(() => {
        if (active && generation === inboxGeneration.current) setInboxLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locale]);

  const pendingCount = inbox?.pendingCount ?? 0;

  const created = (resultId: string) => {
    setCreateOpen(false);
    onOpenResult(resultId);
  };

  return (
    <main className={styles.page} aria-labelledby="results-page-title" aria-busy={loading}>
      <div className={styles.content}>
        <header className={styles.header}>
          <div>
            <h1 ref={heading} tabIndex={-1} id="results-page-title">
              {activeTab === 'results'
                ? t('resultsPageTitle')
                : zh
                  ? '协作收件箱'
                  : 'Collaboration inbox'}
            </h1>
            <p>
              {activeTab === 'results'
                ? zh
                  ? '沉淀、继续编辑和交付你确认过的内容。'
                  : 'Save, continue editing, and deliver your confirmed work.'
                : zh
                  ? '查看收到的分享与审阅意见，处理待办。'
                  : 'Review received shares and feedback.'}
            </p>
          </div>
        </header>
        <div
          className={styles.pageTabs}
          role="tablist"
          aria-label={zh ? '成果视图' : 'Results views'}
        >
          <button
            id="results-tab"
            type="button"
            role="tab"
            aria-controls="results-panel"
            aria-selected={activeTab === 'results'}
            className={activeTab === 'results' ? styles.activeTab : undefined}
            onClick={() => setActiveTab('results')}
          >
            {zh ? '我的成果' : 'My results'}
          </button>
          <button
            id="collaboration-inbox-tab"
            type="button"
            role="tab"
            aria-controls="collaboration-inbox-panel"
            aria-selected={activeTab === 'inbox'}
            className={activeTab === 'inbox' ? styles.activeTab : undefined}
            onClick={() => {
              setActiveTab('inbox');
              void refreshInbox();
            }}
          >
            {zh ? '协作收件箱' : 'Collaboration inbox'}
            {pendingCount > 0 && <span className={styles.inboxBadge}>{pendingCount}</span>}
          </button>
        </div>
        {activeTab === 'inbox' ? (
          <CollaborationInbox
            overview={inbox}
            loading={inboxLoading}
            error={inboxError}
            refresh={refreshInbox}
          />
        ) : (
          <div id="results-panel" role="tabpanel" aria-labelledby="results-tab">
            <div className={styles.resultToolbar}>
              <Input
                aria-label={zh ? '搜索成果' : 'Search results'}
                placeholder={zh ? '搜索成果' : 'Search results'}
                prefix={<SearchOutlined />}
                allowClear
                value={resultQuery}
                onChange={(event) => {
                  setResultQuery(event.target.value);
                  setPage(0);
                }}
              />
              <Button
                className={styles.createButton}
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setCreateOpen(true)}
              >
                {t('createResult')}
              </Button>
            </div>
            <div
              className={styles.resultFilters}
              role="group"
              aria-label={zh ? '成果筛选' : 'Result filters'}
            >
              {(
                [
                  ['all', zh ? '全部' : 'All'],
                  ['document', zh ? '文档' : 'Documents'],
                  ['tool', zh ? '工具成果' : 'Tool results'],
                  ['recent', zh ? '最近编辑' : 'Recently edited'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={resultFilter === key}
                  className={resultFilter === key ? styles.activeFilter : undefined}
                  onClick={() => {
                    setResultFilter(key);
                    setPage(0);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {error ? (
              <Alert type="error" showIcon title={error} closable onClose={clearError} />
            ) : null}
            {loading && filteredResults.length === 0 ? <Skeleton active /> : null}
            {!loading && filteredResults.length === 0 ? (
              <Empty
                description={
                  results.length === 0
                    ? zh
                      ? '还没有成果'
                      : 'No results yet'
                    : zh
                      ? '没有匹配的成果'
                      : 'No matching results'
                }
              />
            ) : null}
            {!error && (!loading || filteredResults.length > 0) ? (
              <div className={styles.resultCount} role="status" aria-live="polite">
                {t('resultRange')
                  .replace('{start}', String(filteredResults.length ? start + 1 : 0))
                  .replace('{end}', String(end))
                  .replace('{total}', String(filteredResults.length))}
              </div>
            ) : null}
            <div className={styles.grid}>
              {filteredResults.slice(start, end).map((result) => {
                const ResultIcon = resultIcons[result.type];
                return (
                  <article key={result.id} className={styles.card}>
                    <div className={styles.cardBody}>
                      <span className={styles.fileIcon} aria-hidden="true">
                        <ResultIcon />
                      </span>
                      <div className={styles.cardText}>
                        <strong>{result.title}</strong>
                        <div className={styles.meta}>
                          <span>
                            {t(resultAdapterDefinitions[result.type].labelKey as MessageKey)}
                          </span>
                          <Tag className={styles.status} data-status={result.status}>
                            {t(statusLabels[result.status])}
                          </Tag>
                          <span>
                            {dateFormat.format(new Date(result.updatedAt.replace(' ', 'T') + 'Z'))}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.cardActions}>
                      <Button
                        className={styles.continueButton}
                        type="text"
                        icon={<RightOutlined />}
                        iconPlacement="end"
                        onClick={() => onOpenResult(result.id)}
                      >
                        {t('continueResult')}
                      </Button>
                      <Button
                        className={styles.pinButton}
                        type="text"
                        icon={result.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                        title={t(result.pinned ? 'unpinResult' : 'pinResult')}
                        aria-label={`${t(result.pinned ? 'unpinResult' : 'pinResult')}: ${result.title}`}
                        aria-pressed={Boolean(result.pinned)}
                        loading={pinningResultIds.includes(result.id)}
                        disabled={
                          loading || saving || deleting || pinningResultIds.includes(result.id)
                        }
                        onClick={async () => {
                          if ((await pinResult(result.id, !result.pinned)) && !result.pinned) {
                            changePage(0);
                          }
                        }}
                      />
                      <Button
                        type="text"
                        icon={<DeleteOutlined />}
                        title={t('deleteResult')}
                        aria-label={`${t('deleteResult')}: ${result.title}`}
                        disabled={saving || deleting || pinningResultIds.includes(result.id)}
                        onClick={() => setDeleteTarget(result)}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
            {filteredResults.length > PAGE_SIZE && (
              <div className={styles.loadMore}>
                <Button disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>
                  {t('previousResults')}
                </Button>
                <Button
                  disabled={end >= results.length}
                  onClick={() => changePage(currentPage + 1)}
                >
                  {t('nextResults')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <Modal
        open={Boolean(deleteTarget)}
        title={t('deleteResult')}
        okText={t('confirmDelete')}
        cancelText={t('cancel')}
        okButtonProps={{ danger: true }}
        confirmLoading={deleting}
        closable={!deleting}
        mask={{ closable: !deleting }}
        cancelButtonProps={{ disabled: deleting }}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onOk={async () => {
          if (!deleteTarget || deleting) return;
          setDeleting(true);
          if (await deleteResult(deleteTarget.id)) setDeleteTarget(null);
          setDeleting(false);
        }}
      >
        <p>{deleteTarget?.title}</p>
        <p>{t('deleteResultHint')}</p>
      </Modal>
      {createOpen && (
        <CreateTextResultModal
          open={createOpen}
          onCancel={() => setCreateOpen(false)}
          onCreated={created}
        />
      )}
    </main>
  );
}
