import { CheckOutlined, CloseOutlined, FileSyncOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Empty, Input, Tag } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import styles from './DiffReview.module.css';

interface Props {
  onOpenResult?: (resultId: string) => void;
}

export function DiffReview({ onOpenResult }: Props) {
  const { t } = useI18n();
  const proposal = useAppStore((state) => state.pendingDiff);
  const applying = useAppStore((state) => state.patchApplying);
  const error = useAppStore((state) => state.patchError);
  const applyDiff = useAppStore((state) => state.applyDiff);
  const rejectDiff = useAppStore((state) => state.rejectDiff);
  const togglePatchChange = useAppStore((state) => state.togglePatchChange);
  const setReviewFileName = useAppStore((state) => state.setReviewFileName);
  const resolveReviewConflict = useAppStore((state) => state.resolveReviewConflict);

  if (!proposal)
    return (
      <div className={styles.empty}>
        <Empty
          description={
            <div className={styles.emptyDescription}>
              <strong>{t('noDiff')}</strong>
              <span>{t('noDiffHint')}</span>
            </div>
          }
        />
      </div>
    );

  const selectedCount = proposal.blocks.filter((block) => block.selected ?? true).length;
  const applyAndContinue = async () => {
    await applyDiff();
    const application = useAppStore.getState().lastReviewApplication;
    if (application?.reviewId === proposal.id && application.result) {
      onOpenResult?.(application.result.result.id);
    }
  };

  return (
    <section className={styles.review} aria-label={t('review')}>
      <div className={styles.summary}>
        <div>
          <FileSyncOutlined />
          <strong>{proposal.summary}</strong>
          <Tag>{t('validatedPatch')}</Tag>
        </div>
        <p>
          {proposal.blocks.length} {t('changeBlocks')} · {selectedCount} {t('selectedBlocks')}
        </p>
      </div>
      {error ? <Alert className={styles.error} type="error" showIcon title={error} /> : null}
      <div className={styles.changeList}>
        {proposal.blocks.map((change) => (
          <article className={styles.change} key={change.id}>
            <header className={styles.changeHeader}>
              <Checkbox
                checked={change.selected ?? true}
                disabled={applying}
                onChange={() => togglePatchChange(change.id)}
              >
                <strong>{change.targetLabel}</strong>
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
            {change.kind === 'create_file' ? (
              <label className={styles.fileNameField}>
                <strong>{t('reviewFileName')}</strong>
                <Input
                  aria-label={t('reviewFileName')}
                  value={change.decidedFileName ?? change.suggestedFileName ?? ''}
                  disabled={applying}
                  onChange={(event) => setReviewFileName(change.id, event.target.value)}
                />
                <span>{t('reviewFileNameHint')}</span>
              </label>
            ) : null}
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
        {proposal.status === 'conflicted' ? (
          <>
            <Button disabled={applying} onClick={() => void resolveReviewConflict('keep_current')}>
              {t('keepCurrentVersion')}
            </Button>
            <Button disabled={applying} onClick={() => void resolveReviewConflict('save_copy')}>
              {t('saveCandidateCopy')}
            </Button>
            <Button
              type="primary"
              loading={applying}
              onClick={() => void resolveReviewConflict('regenerate')}
            >
              {t('regenerateFromCurrent')}
            </Button>
          </>
        ) : (
          <>
            <Button icon={<CloseOutlined />} disabled={applying} onClick={rejectDiff}>
              {t('rejectAll')}
            </Button>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              loading={applying}
              disabled={selectedCount === 0}
              onClick={() => void applyAndContinue()}
            >
              {t('acceptSelected')} ({selectedCount})
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
