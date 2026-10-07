import type { ReactNode } from 'react';
import styles from './WorkItemFrame.module.css';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

export function WorkItemHeader({
  icon,
  title,
  type,
  status,
  tone = 'neutral',
  details,
  actions,
  progress,
}: {
  icon?: ReactNode;
  title: ReactNode;
  type: ReactNode;
  status?: ReactNode;
  tone?: Tone;
  details?: ReactNode;
  actions?: ReactNode;
  progress?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <div className={styles.titleLine}>
          {icon && (
            <span className={styles.icon} aria-hidden="true">
              {icon}
            </span>
          )}
          <h1>{title}</h1>
        </div>
        <div className={styles.metadata}>
          <span>{type}</span>
          {status && (
            <span className={styles.status} data-tone={tone} role="status">
              {status}
            </span>
          )}
          {details}
        </div>
        {progress && <div className={styles.progress}>{progress}</div>}
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}

export function WorkItemNavigation({
  children,
  actions,
  tabs = false,
}: {
  children: ReactNode;
  actions?: ReactNode;
  tabs?: boolean;
}) {
  return (
    <div className={tabs ? styles.tabNavigation : styles.navigation}>
      {children}
      {actions && <div className={styles.navigationActions}>{actions}</div>}
    </div>
  );
}
