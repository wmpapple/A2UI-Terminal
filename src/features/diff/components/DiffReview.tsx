import { CheckOutlined, CloseOutlined, FileSyncOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Empty, Tag } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import styles from './DiffReview.module.css';

export function DiffReview() {
  const { t } = useI18n();
  const proposal = useAppStore((state) => state.pendingDiff);
  const applying = useAppStore((state) => state.patchApplying);
  const error = useAppStore((state) => state.patchError);
  const applyDiff = useAppStore((state) => state.applyDiff);
  const rejectDiff = useAppStore((state) => state.rejectDiff);
  const togglePatchChange = useAppStore((state) => state.togglePatchChange);

  if (!proposal)
    return (
      <div className={styles.empty}>
        <Empty description={t('noDiff')} />
      </div>
    );

  const selectedCount = proposal.changes.filter((change) => change.selected).length;

  return (
    <section className={styles.review} aria-label={t('review')}>
      <div className={styles.summary}>
        <div>
          <FileSyncOutlined />
          <strong>{proposal.summary}</strong>
          <Tag>{t('validatedPatch')}</Tag>
        </div>
        <p>
          {proposal.changes.length} {t('changeBlocks')} · {selectedCount} {t('selectedBlocks')}
        </p>
      </div>
      {error ? <Alert className={styles.error} type="error" showIcon title={error} /> : null}
      <div className={styles.changeList}>
        {proposal.changes.map((change) => (
          <article className={styles.change} key={change.id}>
            <header className={styles.changeHeader}>
              <Checkbox
                checked={change.selected}
                disabled={applying}
                onChange={() => togglePatchChange(change.id)}
              >
                <strong>{change.path}</strong>
              </Checkbox>
              <span>
                <Tag>{change.operation}</Tag>
                <Tag
                  color={
                    change.risk === 'high' ? 'red' : change.risk === 'medium' ? 'orange' : 'green'
                  }
                >
                  {change.risk}
                </Tag>
              </span>
            </header>
            <p className={styles.reason}>
              <span>{t('diffReason')}:</span> {change.reason}
            </p>
            <div className={styles.diffGrid}>
              <section>
                <header>{t('before')}</header>
                <pre>{change.before || t('emptyContent')}</pre>
              </section>
              <section>
                <header>{t('after')}</header>
                <pre>{change.after || t('emptyContent')}</pre>
              </section>
            </div>
          </article>
        ))}
      </div>
      <footer className={styles.actions}>
        <Button icon={<CloseOutlined />} disabled={applying} onClick={rejectDiff}>
          {t('rejectAll')}
        </Button>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          loading={applying}
          disabled={selectedCount === 0}
          onClick={() => void applyDiff()}
        >
          {t('acceptSelected')} ({selectedCount})
        </Button>
      </footer>
    </section>
  );
}
