import {
  FileSearchOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { Alert, Button, Empty, Input, Tag, message } from 'antd';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ContextSelection, SearchAuthorizedContentOutput } from '../../../shared/types/domain';
import { errorDetails } from '../../../stores/support';
import { useAppStore } from '../../../stores/useAppStore';
import { homeController } from '../homeController';
import styles from './HomePage.module.css';
import { SearchEmptyIllustration } from './SearchEmptyIllustration';

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

export function AuthorizedSearch(props: Props) {
  const workspaceId = useAppStore((state) => state.workspace?.id ?? null);
  return <WorkspaceSearch key={workspaceId ?? 'none'} {...props} />;
}

function WorkspaceSearch({ onOpenWorkbench }: Props) {
  const { t } = useI18n();
  const titleId = useId();
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
  const [composing, setComposing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const requestVersion = useRef({ value: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const workspaceId = workspace?.id ?? null;

  const runSearch = useCallback(
    async (value: string) => {
      clearTimeout(timer.current);
      const version = ++requestVersion.current.value;
      const normalized = value.trim();
      if (!normalized) {
        setResult(null);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const next = await homeController.search(workspaceId, normalized);
        if (version === requestVersion.current.value) setResult(next);
      } catch (searchError) {
        if (version !== requestVersion.current.value) return;
        setResult(null);
        setError(errorDetails(searchError).message);
      } finally {
        if (version === requestVersion.current.value) setLoading(false);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    const version = requestVersion.current;
    if (query.trim() && !composing) timer.current = setTimeout(() => void runSearch(query), 250);
    return () => {
      clearTimeout(timer.current);
      version.value++;
    };
  }, [query, composing, refresh, runSearch]);

  const rebuild = async () => {
    setRepairing(true);
    setError(null);
    try {
      await homeController.rebuildSearchIndex();
      setRefresh((value) => value + 1);
      void message.success(t('searchIndexRebuilt'));
    } catch (rebuildError) {
      setError(errorDetails(rebuildError).message);
    } finally {
      setRepairing(false);
    }
  };

  const startWithContext = (
    kind: 'document_source' | 'context_pack' | 'personal_knowledge',
    id: string
  ) => {
    if (!workspace || !activeSessionId) {
      setError(t('searchTaskNeedsWorkspace'));
      return;
    }
    const current = contextBySession[activeSessionId] ?? defaultContext();
    const next =
      kind === 'personal_knowledge'
        ? {
            ...current,
            personalKnowledgeIds: [...new Set([...(current.personalKnowledgeIds ?? []), id])],
          }
        : kind === 'document_source'
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
    <section className={styles.section} aria-labelledby={titleId}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 id={titleId}>{t('authorizedSearchTitle')}</h2>
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
      <form
        className={styles.searchBar}
        onSubmit={(event) => {
          event.preventDefault();
          if (!loading && !composing) void runSearch(query);
        }}
      >
        <Input
          variant="borderless"
          size="large"
          prefix={<FileSearchOutlined aria-hidden="true" />}
          suffix={
            <span className={styles.searchShortcut} title={t('commandPalette')}>
              <kbd>Ctrl / ⌘</kbd>
              <kbd>K</kbd>
            </span>
          }
          allowClear
          maxLength={200}
          placeholder={t('authorizedSearchPlaceholder')}
          value={query}
          onChange={(event) => {
            requestVersion.current.value++;
            setResult(null);
            setError(null);
            setLoading(false);
            setQuery(event.target.value);
            if (!event.target.value) {
              setResult(null);
              setError(null);
            }
          }}
          onCompositionStart={() => {
            clearTimeout(timer.current);
            requestVersion.current.value++;
            setComposing(true);
          }}
          onCompositionEnd={() => setComposing(false)}
          onPressEnter={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) event.preventDefault();
          }}
        />
        <Button htmlType="submit" type="primary" loading={loading} className={styles.searchSubmit}>
          {t('searchAuthorizedContent')}
        </Button>
      </form>
      {error ? <Alert className={styles.notice} type="error" showIcon title={error} /> : null}
      {result && result.items.length === 0 ? (
        <Empty
          className={styles.searchEmpty}
          image={<SearchEmptyIllustration />}
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
                        : item.kind === 'personal_knowledge'
                          ? 'knowledgeNavigation'
                          : item.kind === 'document_source'
                            ? 'searchKindSource'
                            : 'searchKindPack'
                    )}
                  </Tag>
                </div>
                <p>{item.snippet}</p>
              </div>
              {item.kind === 'personal_knowledge' && (
                <Button
                  size="small"
                  onClick={() => {
                    window.location.hash = `#/knowledge?id=${encodeURIComponent(item.id)}`;
                  }}
                >
                  {t('openKnowledgeSource')}
                </Button>
              )}
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
                  onClick={() => {
                    if (item.kind !== 'result') startWithContext(item.kind, item.id);
                  }}
                >
                  {t('startTaskWithSearchItem')}
                </Button>
              )}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
