import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { Alert, Button, Skeleton } from 'antd';
import { useI18n } from './i18n/useI18n';
import styles from './AppShell.module.css';

class FeatureError extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// The factory keeps a failed import retry local, preserving application state and drafts.
export function lazyFeature<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  const Initial = lazy(load);
  return function LazyFeature(props: P) {
    const { t } = useI18n();
    const [attempt, setAttempt] = useState({ Page: Initial, key: 0 });
    const Page = attempt.Page;
    return (
      <FeatureError
        key={attempt.key}
        fallback={
          <div className={styles.pageLoading}>
            <Alert
              type="error"
              showIcon
              title={t('pageLoadFailed')}
              action={
                <Button onClick={() => setAttempt({ Page: lazy(load), key: attempt.key + 1 })}>
                  {t('retryPage')}
                </Button>
              }
            />
          </div>
        }
      >
        <Suspense
          fallback={
            <div className={styles.pageLoading} role="status" aria-label={t('pageLoading')}>
              <Skeleton active />
            </div>
          }
        >
          <Page {...props} />
        </Suspense>
      </FeatureError>
    );
  };
}
