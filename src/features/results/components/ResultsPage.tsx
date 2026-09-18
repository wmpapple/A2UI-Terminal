import { FileAddOutlined, RightOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Skeleton, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { MessageKey } from '../../../app/i18n/messages';
import type { ResultStatus } from '../../../shared/types/domain';
import { resultAdapterDefinitions } from '../resultAdapters';
import { useResultStore } from '../resultStore';
import { CreateTextResultModal } from './CreateTextResultModal';
import styles from './ResultsPage.module.css';

const INITIAL_RESULT_COUNT = 40;
const RESULT_COUNT_STEP = 40;

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
  const [createOpen, setCreateOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_RESULT_COUNT);

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
            <h1 id="results-page-title">{t('resultsPageTitle')}</h1>
            <p>{t('resultsWorkbenchDescription')}</p>
          </div>
          <Button type="primary" icon={<FileAddOutlined />} onClick={() => setCreateOpen(true)}>
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
            {t('resultsShowingCount')
              .replace('{visible}', String(Math.min(visibleCount, results.length)))
              .replace('{total}', String(results.length))}
          </div>
        ) : null}
        <div className={styles.grid}>
          {results.slice(0, visibleCount).map((result) => (
            <article key={result.id} className={styles.card}>
              <div>
                <strong>{result.title}</strong>
                <div className={styles.meta}>
                  <Tag>{t(resultAdapterDefinitions[result.type].labelKey as MessageKey)}</Tag>
                  <Tag color={result.status === 'failed' ? 'red' : 'blue'}>
                    {t(statusLabels[result.status])}
                  </Tag>
                  <span>
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(result.updatedAt.replace(' ', 'T') + 'Z'))}
                  </span>
                </div>
              </div>
              <Button icon={<RightOutlined />} onClick={() => onOpenResult(result.id)}>
                {t('continueResult')}
              </Button>
            </article>
          ))}
        </div>
        {visibleCount < results.length ? (
          <div className={styles.loadMore}>
            <Button
              onClick={() =>
                setVisibleCount((current) => Math.min(current + RESULT_COUNT_STEP, results.length))
              }
            >
              {t('showMoreResults')}
            </Button>
          </div>
        ) : null}
      </div>
      <CreateTextResultModal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onCreated={created}
      />
    </main>
  );
}
