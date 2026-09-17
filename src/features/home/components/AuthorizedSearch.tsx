import {
  FileSearchOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { Alert, Button, Empty, Input, Tag, message } from 'antd';
import { useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ContextSelection, SearchAuthorizedContentOutput } from '../../../shared/types/domain';
import { errorDetails } from '../../../stores/support';
import { useAppStore } from '../../../stores/useAppStore';
import { homeController } from '../homeController';
import styles from './HomePage.module.css';

interface Props {
  onOpenWorkbench: (resultId?: string) => void;
}

const defaultContext = (): ContextSelection => ({
  selection: false,
  currentFile: false,
  recentMessages: false,
  recentMessageCount: 3,
  projectFiles: [],
  documentSourceIds: [],
  contextPackIds: [],
});

export function AuthorizedSearch({ onOpenWorkbench }: Props) {
  const { t } = useI18n();
  const workspace = useAppStore((state) => state.workspace);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const contextBySession = useAppStore((state) => state.contextBySession);
  const setSessionContext = useAppStore((state) => state.setSessionContext);
  const setSessionContextReviewKey = useAppStore((state) => state.setSessionContextReviewKey);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchAuthorizedContentOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (value: string) => {
    const normalized = value.trim();
    setQuery(value);
    if (!normalized) {
      setResult(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResult(await homeController.search(workspace?.id ?? null, normalized));
    } catch (searchError) {
      setResult(null);
      setError(errorDetails(searchError).message);
    } finally {
      setLoading(false);
    }
  };

  const rebuild = async () => {
    setRepairing(true);
    setError(null);
    try {
      await homeController.rebuildSearchIndex();
      if (query.trim()) await runSearch(query);
      void message.success(t('searchIndexRebuilt'));
    } catch (rebuildError) {
      setError(errorDetails(rebuildError).message);
    } finally {
      setRepairing(false);
    }
  };

  const startWithContext = (kind: 'document_source' | 'context_pack', id: string) => {
    if (!workspace || !activeSessionId) {
      setError(t('searchTaskNeedsWorkspace'));
      return;
    }
    const current = contextBySession[activeSessionId] ?? defaultContext();
    const next =
      kind === 'document_source'
        ? {
            ...current,
            documentSourceIds: [...new Set([...(current.documentSourceIds ?? []), id])],
          }
        : {
            ...current,
            contextPackIds: [...new Set([...(current.contextPackIds ?? []), id])],
          };
    setSessionContext(activeSessionId, next);
    setSessionContextReviewKey(activeSessionId, 'search-selection-needs-review');
    void message.success(t('searchContextPrepared'));
    onOpenWorkbench();
  };

  return (
    <section className={styles.section} aria-labelledby="authorized-search-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="authorized-search-title">{t('authorizedSearchTitle')}</h2>
          <p className={styles.sectionDescription}>{t('authorizedSearchDescription')}</p>
        </div>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={repairing}
          onClick={() => void rebuild()}
        >
          {t('repairSearchIndex')}
        </Button>
      </div>
      <Input.Search
        allowClear
        enterButton={t('searchAuthorizedContent')}
        maxLength={200}
        loading={loading}
        placeholder={t('authorizedSearchPlaceholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (!event.target.value) {
            setResult(null);
            setError(null);
          }
        }}
        onSearch={(value) => void runSearch(value)}
      />
      {error ? <Alert className={styles.notice} type="error" showIcon title={error} /> : null}
      {result && result.items.length === 0 ? (
        <Empty
          className={styles.searchEmpty}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('authorizedSearchEmpty')}
        />
      ) : null}
      {result && result.items.length > 0 ? (
        <div className={styles.searchResults} aria-live="polite">
          {result.items.map((item) => (
            <article key={`${item.kind}:${item.id}`} className={styles.searchItem}>
              <div className={styles.searchItemBody}>
                <div className={styles.searchItemTitle}>
                  <FileSearchOutlined />
                  <strong>{item.title}</strong>
                  <Tag>
                    {t(
                      item.kind === 'result'
                        ? 'searchKindResult'
                        : item.kind === 'document_source'
                          ? 'searchKindSource'
                          : 'searchKindPack'
                    )}
                  </Tag>
                </div>
                <p>{item.snippet}</p>
              </div>
              {item.kind === 'result' ? (
                <Button
                  size="small"
                  icon={<FolderOpenOutlined />}
                  onClick={() => onOpenWorkbench(item.id)}
                >
                  {t('openSearchResult')}
                </Button>
              ) : (
                <Button
                  size="small"
                  icon={<RocketOutlined />}
                  onClick={() =>
                    startWithContext(
                      item.kind === 'document_source' ? 'document_source' : 'context_pack',
                      item.id
                    )
                  }
                >
                  {t('startTaskWithSearchItem')}
                </Button>
              )}
            </article>
          ))}
        </div>
      ) : null}
      <p className={styles.searchPrivacy}>{t('authorizedSearchPrivacy')}</p>
    </section>
  );
}
