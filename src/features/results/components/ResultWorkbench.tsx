import {
  CopyOutlined,
  DiffOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileDoneOutlined,
  HistoryOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Modal,
  Segmented,
  Skeleton,
  Tag,
  Tooltip,
  message,
} from 'antd';
import TextArea from 'antd/es/input/TextArea';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { MessageKey } from '../../../app/i18n/messages';
import { renderSafeMarkdown } from '../../../shared/markdown/renderSafeMarkdown';
import type { FileSaveStatus, ResultAppliedReview } from '../../../shared/types/domain';
import { useResultStore } from '../resultStore';
import styles from './ResultWorkbench.module.css';

interface Props {
  resultId: string;
  onDuplicated: (resultId: string) => void;
  onOpenResults: () => void;
  reviewUndoing?: boolean;
  reviewUndoError?: string | null;
  onUndoReview?: (review: ResultAppliedReview) => void;
}

const saveColors: Record<FileSaveStatus, string> = {
  saved: 'green',
  dirty: 'orange',
  draft: 'gold',
  saving: 'processing',
  conflict: 'red',
  error: 'red',
};

const saveStatusKeys: Record<FileSaveStatus, MessageKey> = {
  saved: 'resultSaveStatus_saved',
  dirty: 'resultSaveStatus_dirty',
  draft: 'resultSaveStatus_draft',
  saving: 'resultSaveStatus_saving',
  conflict: 'resultSaveStatus_conflict',
  error: 'resultSaveStatus_error',
};

export function ResultWorkbench({
  resultId,
  onDuplicated,
  onOpenResults,
  reviewUndoing = false,
  reviewUndoError = null,
  onUndoReview,
}: Props) {
  const { t } = useI18n();
  const activeDocument = useResultStore((state) => state.activeDocument);
  const draftContent = useResultStore((state) => state.draftContent);
  const saveStatus = useResultStore((state) => state.saveStatus);
  const revisions = useResultStore((state) => state.revisions);
  const preview = useResultStore((state) => state.preview);
  const loading = useResultStore((state) => state.loading);
  const saving = useResultStore((state) => state.saving);
  const error = useResultStore((state) => state.error);
  const openResult = useResultStore((state) => state.openResult);
  const updateDraft = useResultStore((state) => state.updateDraft);
  const save = useResultStore((state) => state.save);
  const loadRevisions = useResultStore((state) => state.loadRevisions);
  const previewRevision = useResultStore((state) => state.previewRevision);
  const restoreRevision = useResultStore((state) => state.restoreRevision);
  const undo = useResultStore((state) => state.undo);
  const duplicate = useResultStore((state) => state.duplicate);
  const clearPreview = useResultStore((state) => state.clearPreview);
  const clearError = useResultStore((state) => state.clearError);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview');

  useEffect(() => {
    void openResult(resultId);
  }, [openResult, resultId]);

  useEffect(() => {
    if (saveStatus !== 'dirty') return;
    const timer = window.setTimeout(() => void save(), 1000);
    return () => window.clearTimeout(timer);
  }, [draftContent, save, saveStatus]);

  const changed = activeDocument ? draftContent !== activeDocument.content : false;
  const changeStats = useMemo(() => {
    if (!activeDocument) return { before: 0, after: 0 };
    return {
      before: activeDocument.content.split('\n').length,
      after: draftContent.split('\n').length,
    };
  }, [activeDocument, draftContent]);

  const showHistory = () => {
    setHistoryOpen(true);
    void loadRevisions();
  };

  const makeCopy = async () => {
    if (saveStatus === 'dirty') await save();
    const copy = await duplicate();
    if (copy) onDuplicated(copy.result.id);
  };

  if (loading && !activeDocument) return <Skeleton className={styles.loading} active />;
  if (!activeDocument)
    return (
      <div className={styles.empty}>
        {error ? (
          <Alert type="error" showIcon title={error} />
        ) : (
          <Empty description={t('resultOpenFailed')} />
        )}
      </div>
    );
  const appliedReview = activeDocument.appliedReview;

  return (
    <section className={styles.workbench} aria-label={t('resultWorkspace')}>
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <strong>{activeDocument.result.title}</strong>
          <span>
            {activeDocument.format === 'markdown' ? 'Markdown' : t('plainText')} ·{' '}
            {t('managedResultLocation')}
          </span>
          <Button type="link" size="small" icon={<FileDoneOutlined />} onClick={onOpenResults}>
            {t('openMyResults')}
          </Button>
        </div>
        <div className={styles.actions}>
          {activeDocument.format === 'markdown' ? (
            <Segmented
              value={viewMode}
              onChange={(value) => setViewMode(value as 'preview' | 'edit')}
              options={[
                { label: t('previewResult'), value: 'preview', icon: <EyeOutlined /> },
                { label: t('editResult'), value: 'edit', icon: <EditOutlined /> },
              ]}
            />
          ) : null}
          <Tag color={saveColors[saveStatus]}>{t(saveStatusKeys[saveStatus])}</Tag>
          <Button
            icon={<SaveOutlined />}
            loading={saving}
            disabled={!changed}
            onClick={() => void save()}
          >
            {t('saveResult')}
          </Button>
          <Button icon={<DiffOutlined />} onClick={() => setDiffOpen(true)}>
            {t('viewChanges')}
          </Button>
          {appliedReview && onUndoReview ? (
            <Button
              icon={<UndoOutlined />}
              loading={reviewUndoing}
              onClick={() => onUndoReview(appliedReview)}
            >
              {t('undoPatch')}
            </Button>
          ) : null}
          <Button icon={<UndoOutlined />} disabled={changed} onClick={() => void undo()}>
            {t('undoResult')}
          </Button>
          <Button icon={<HistoryOutlined />} onClick={showHistory}>
            {t('resultHistory')}
          </Button>
          <Button icon={<CopyOutlined />} onClick={() => void makeCopy()}>
            {t('saveAsCopy')}
          </Button>
          <Tooltip title={t('exportResultPending')}>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => void message.info(t('exportResultPending'))}
            >
              {t('exportResult')}
            </Button>
          </Tooltip>
        </div>
      </header>
      {reviewUndoError ? (
        <Alert type="error" showIcon title={reviewUndoError} data-testid="review-undo-error" />
      ) : null}
      {error ? <Alert type="error" showIcon title={error} closable onClose={clearError} /> : null}
      {activeDocument.format === 'markdown' && viewMode === 'preview' ? (
        <article
          className={styles.markdownPreview}
          aria-label={t('resultPreview')}
          dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(draftContent) }}
        />
      ) : (
        <TextArea
          className={styles.editor}
          aria-label={t('resultEditor')}
          value={draftContent}
          disabled={!activeDocument.editable}
          onChange={(event) => updateDraft(event.target.value)}
          autoSize={false}
        />
      )}

      <Modal
        open={diffOpen}
        title={t('viewChanges')}
        footer={null}
        width={900}
        onCancel={() => setDiffOpen(false)}
      >
        <p>
          {t('resultChangeSummary')
            .replace('{before}', String(changeStats.before))
            .replace('{after}', String(changeStats.after))}
        </p>
        <div className={styles.diffGrid}>
          <div>
            <strong>{t('before')}</strong>
            <pre>{activeDocument.content}</pre>
          </div>
          <div>
            <strong>{t('after')}</strong>
            <pre>{draftContent}</pre>
          </div>
        </div>
      </Modal>

      <Drawer
        open={historyOpen}
        title={t('resultHistory')}
        size="large"
        onClose={() => {
          setHistoryOpen(false);
          clearPreview();
        }}
      >
        {revisions.length === 0 ? <Empty description={t('noResultHistory')} /> : null}
        <div className={styles.versionList}>
          {revisions.map((revision) => (
            <article key={revision.id} className={styles.versionItem}>
              <div>
                <strong>{revision.summary ?? revision.source}</strong>
                <span>{revision.createdAt}</span>
              </div>
              {revision.isCurrent ? <Tag color="green">{t('currentVersion')}</Tag> : null}
              <Button type="link" onClick={() => void previewRevision(revision.id)}>
                {t('previewVersion')}
              </Button>
              <Button
                type="link"
                disabled={revision.isCurrent}
                onClick={() => void restoreRevision(revision.id)}
              >
                {t('restoreVersion')}
              </Button>
            </article>
          ))}
        </div>
        {preview ? <pre className={styles.preview}>{preview.content}</pre> : null}
      </Drawer>
    </section>
  );
}
