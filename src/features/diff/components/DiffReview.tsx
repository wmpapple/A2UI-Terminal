import { CheckOutlined, CloseOutlined, FileSyncOutlined } from '@ant-design/icons';
import { Button, Empty, Tag } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import styles from './DiffReview.module.css';

export function DiffReview() {
  const { t } = useI18n();
  const proposal = useAppStore((state) => state.pendingDiff);
  const applyDiff = useAppStore((state) => state.applyDiff);
  const rejectDiff = useAppStore((state) => state.rejectDiff);

  if (!proposal)
    return (
      <div className={styles.empty}>
        <Empty description={t('noDiff')} />
      </div>
    );

  return (
    <section className={styles.review} aria-label={t('review')}>
      <div className={styles.summary}>
        <div>
          <FileSyncOutlined />
          <strong>{proposal.path}</strong>
          <Tag color="orange">{proposal.risk}</Tag>
        </div>
        <p>
          <span>{t('diffReason')}:</span> {proposal.reason}
        </p>
      </div>
      <div className={styles.diffGrid}>
        <article>
          <header>{t('before')}</header>
          <pre>{proposal.before}</pre>
        </article>
        <article>
          <header>{t('after')}</header>
          <pre>{proposal.after}</pre>
        </article>
      </div>
      <footer className={styles.actions}>
        <Button icon={<CloseOutlined />} onClick={rejectDiff}>
          {t('rejectAll')}
        </Button>
        <Button type="primary" icon={<CheckOutlined />} onClick={applyDiff}>
          {t('acceptSelected')}
        </Button>
      </footer>
    </section>
  );
}
