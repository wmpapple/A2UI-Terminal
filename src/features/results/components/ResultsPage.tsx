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

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  const created = (resultId: string) => {
    setCreateOpen(false);
    onOpenResult(resultId);
  };

  return (
    <main className={styles.page} aria-labelledby="results-page-title">
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
        <div className={styles.grid}>
          {results.map((result) => (
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
      </div>
      <CreateTextResultModal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onCreated={created}
      />
    </main>
  );
}
