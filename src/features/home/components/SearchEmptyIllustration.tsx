import styles from './HomePage.module.css';

export function SearchEmptyIllustration() {
  return (
    <svg className={styles.searchEmptyArt} viewBox="0 0 160 96" fill="none" aria-hidden="true">
      <ellipse cx="80" cy="83" rx="52" ry="5" fill="var(--surface-subtle)" />
      <rect
        x="42"
        y="10"
        width="61"
        height="69"
        rx="8"
        fill="var(--panel)"
        stroke="var(--text-muted)"
        strokeOpacity=".35"
      />
      <path
        d="M55 26h32M55 36h23M55 46h15"
        stroke="var(--text-muted)"
        strokeOpacity=".35"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle
        cx="99"
        cy="59"
        r="17"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="2"
      />
      <path
        d="m111 72 13 13M94 59h10"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M124 20v8m-4-4h8" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
