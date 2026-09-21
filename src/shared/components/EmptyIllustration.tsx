import styles from './EmptyIllustration.module.css';

/** Decorative, code-native artwork; all guidance remains accessible text. */
export function EmptyIllustration() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <div className={styles.back} />
      <div className={styles.sheet}>
        <svg viewBox="0 0 48 48" fill="none">
          <rect x="10" y="8" width="28" height="32" rx="5" />
          <path d="M17 18h14M17 24h14M17 30h8" />
        </svg>
      </div>
      <span className={styles.spark}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" focusable="false">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );
}
