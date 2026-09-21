import styles from './ChatPanel.module.css';

export function AssistantMark() {
  return (
    <span className={styles.assistantMark} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M16 4 20 12 28 16 20 20 16 28 12 20 4 16 12 12Z" fill="currentColor" />
        <path
          d="m25 3 1.3 2.7L29 7l-2.7 1.3L25 11l-1.3-2.7L21 7l2.7-1.3Z"
          fill="currentColor"
          opacity=".5"
        />
      </svg>
    </span>
  );
}
