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
} from '@ant-design/icons';
import { Alert, Button, Empty, Skeleton, Tag, Modal } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { MessageKey } from '../../../app/i18n/messages';
import type { ResultStatus, ResultType } from '../../../shared/types/domain';
import { resultAdapterDefinitions } from '../resultAdapters';
import { useResultStore } from '../resultStore';
import { lazyFeature } from '../../../app/lazyFeature';
import styles from './ResultsPage.module.css';

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
  const heading = useRef<HTMLHeadingElement>(null);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(results.length / PAGE_SIZE) - 1));
  const start = currentPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, results.length);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const changePage = (next: number) => {
    setPage(next);
    heading.current?.scrollIntoView({ block: 'start' });
    heading.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

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
              {t('resultsPageTitle')}
            </h1>
            <p>{t('resultsWorkbenchDescription')}</p>
          </div>
          <Button
            className={styles.createButton}
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            {t('createResult')}
          </Button>
        </header>
        {error ? <Alert type="error" showIcon title={error} closable onClose={clearError} /> : null}
        {loading && results.length === 0 ? <Skeleton active /> : null}
        {!loading && results.length === 0 ? (
          <Empty description={t('resultsPageEmpty')}>
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              {t('createResult')}
            </Button>
          </Empty>
        ) : null}
        {!error && (!loading || results.length > 0) ? (
          <div className={styles.resultCount} role="status" aria-live="polite">
            {t('resultRange')
              .replace('{start}', String(results.length ? start + 1 : 0))
              .replace('{end}', String(end))
              .replace('{total}', String(results.length))}
          </div>
        ) : null}
        <div className={styles.grid}>
          {results.slice(start, end).map((result) => {
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
                      <span>{t(resultAdapterDefinitions[result.type].labelKey as MessageKey)}</span>
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
                    disabled={loading || saving || deleting || pinningResultIds.includes(result.id)}
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
        {results.length > PAGE_SIZE && (
          <div className={styles.loadMore}>
            <Button disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>
              {t('previousResults')}
            </Button>
            <Button disabled={end >= results.length} onClick={() => changePage(currentPage + 1)}>
              {t('nextResults')}
            </Button>
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
