import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './HomePage.module.css';

export function RecentResultsList({ children, label }: { children: ReactNode; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  const [moreBelow, setMoreBelow] = useState(false);
  const update = () => {
    const element = container.current;
    if (!element) return;
    setCanScroll(element.scrollHeight > element.clientHeight + 2);
    setMoreBelow(element.scrollHeight - element.scrollTop - element.clientHeight > 2);
  };
  useEffect(() => {
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    if (container.current) observer?.observe(container.current);
    if (content.current) observer?.observe(content.current);
    return () => observer?.disconnect();
  }, [children]);
  return (
    <div
      ref={container}
      className={`${styles.resultsViewport} ${moreBelow ? styles.resultsFade : ''}`}
      onScroll={update}
      role="region"
      aria-label={label}
      tabIndex={canScroll ? 0 : undefined}
    >
      <div ref={content} className={styles.results}>
        {children}
      </div>
    </div>
  );
}
