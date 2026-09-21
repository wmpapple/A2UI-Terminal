import { WorkbenchAppearanceControl } from '../../../app/WorkbenchAppearanceControl';
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
import { Alert, Button, Drawer, Empty, Modal, Segmented, Skeleton, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { resultController } from '../resultController';
import { useI18n } from '../../../app/i18n/useI18n';
import type { MessageKey } from '../../../app/i18n/messages';
import type { FileSaveStatus, ResultAppliedReview } from '../../../shared/types/domain';
import { finishPerformanceMeasurement } from '../../../shared/performance/performanceBudget';
import { resultAdapterDefinitions } from '../resultAdapters';
import { useResultStore } from '../resultStore';
import { ExportResultModal } from './ExportResultModal';
import { ResultContentAdapter } from './ResultContentAdapter';
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
  const persistDraft = useResultStore((state) => state.persistDraft);
  const restoreRecoveryDraft = useResultStore((state) => state.restoreRecoveryDraft);
  const discardRecoveryDraft = useResultStore((state) => state.discardRecoveryDraft);
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
  const diffRequest = useRef(0);
  const [comparison, setComparison] = useState<{
    resultId: string;
    before: string | null;
    after: string;
    saved: boolean;
    loading: boolean;
    error: boolean;
  } | null>(null);
  useEffect(
    () => () => {
      diffRequest.current++;
    },
    [resultId]
  );
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview');
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void openResult(resultId).then(() => {
      if (cancelled || useResultStore.getState().activeDocument?.result.id !== resultId) return;
      window.requestAnimationFrame(() => finishPerformanceMeasurement('resultOpen'));
    });
    return () => {
      cancelled = true;
    };
  }, [openResult, resultId]);

  useEffect(() => {
    if (saveStatus !== 'dirty') return;
    const timer = window.setTimeout(() => void persistDraft(), 250);
    return () => window.clearTimeout(timer);
  }, [draftContent, persistDraft, saveStatus]);

  useEffect(() => {
    if (saveStatus !== 'dirty') return;
    const timer = window.setTimeout(() => void save(), 1000);
    return () => window.clearTimeout(timer);
  }, [draftContent, save, saveStatus]);

  const changed = activeDocument ? draftContent !== activeDocument.content : false;
  const showChanges = async () => {
    if (!activeDocument) return;
    const request = ++diffRequest.current;
    const snapshot = {
      resultId: activeDocument.result.id,
      before: changed ? activeDocument.content : null,
      after: draftContent,
      saved: !changed,
      loading: !changed,
      error: false,
    };
    setComparison(snapshot);
    setDiffOpen(true);
    if (changed) return;
    try {
      const history = await resultController.listRevisions(snapshot.resultId);
      const previous = history.find((item) => item.contentHash !== activeDocument.contentHash);
      const before = previous
        ? (await resultController.readRevision(snapshot.resultId, previous.id)).content
        : null;
      if (request === diffRequest.current) setComparison({ ...snapshot, before, loading: false });
    } catch {
      if (request === diffRequest.current)
        setComparison({ ...snapshot, loading: false, error: true });
    }
  };

  const showHistory = () => {
    setHistoryOpen(true);
    void loadRevisions();
  };

  const makeCopy = async () => {
    if (saveStatus === 'dirty') await save();
    const copy = await duplicate();
    if (copy) onDuplicated(copy.result.id);
  };

  if (loading && !activeDocument)
    return (
      <div className={styles.loading} role="status" aria-label={t('resultLoading')}>
        <Skeleton active />
      </div>
    );
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
  const adapter = resultAdapterDefinitions[activeDocument.result.type];

  return (
    <section
      className={styles.workbench}
      aria-label={t('resultWorkspace')}
      aria-busy={loading || saving}
    >
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <strong>{activeDocument.result.title}</strong>
          <span>
            {t(adapter.labelKey as MessageKey)} · {activeDocument.format.toUpperCase()} ·{' '}
            {t('managedResultLocation')}
          </span>
          <Button type="link" size="small" icon={<FileDoneOutlined />} onClick={onOpenResults}>
            {t('openMyResults')}
          </Button>
        </div>
        <div className={styles.actions}>
          <WorkbenchAppearanceControl />
          {activeDocument.editable ? (
            <Segmented
              value={viewMode}
              onChange={(value) => setViewMode(value as 'preview' | 'edit')}
              options={[
                { label: t('previewResult'), value: 'preview', icon: <EyeOutlined /> },
                { label: t('editResult'), value: 'edit', icon: <EditOutlined /> },
              ]}
            />
          ) : null}
          <Tag color={saveColors[saveStatus]} role="status" aria-live="polite">
            {t(saveStatusKeys[saveStatus])}
          </Tag>
          <Button
            icon={<SaveOutlined />}
            loading={saving}
            disabled={!activeDocument.editable || !changed}
            onClick={() => void save()}
          >
            {t('saveResult')}
          </Button>
          <Button icon={<DiffOutlined />} onClick={() => void showChanges()}>
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
          <Button
            icon={<UndoOutlined />}
            disabled={!activeDocument.editable || changed}
            onClick={() => void undo()}
          >
            {t('undoResult')}
          </Button>
          <Button icon={<HistoryOutlined />} onClick={showHistory}>
            {t('resultHistory')}
          </Button>
          <Button
            icon={<CopyOutlined />}
            disabled={!activeDocument.editable}
            onClick={() => void makeCopy()}
          >
            {t('saveAsCopy')}
          </Button>
          <Button
            icon={<DownloadOutlined />}
            disabled={activeDocument.result.currentRevisionId === null}
            onClick={() => setExportOpen(true)}
          >
            {t('exportResult')}
          </Button>
        </div>
      </header>
      {reviewUndoError ? (
        <Alert type="error" showIcon title={reviewUndoError} data-testid="review-undo-error" />
      ) : null}
      {error ? <Alert type="error" showIcon title={error} closable onClose={clearError} /> : null}
      <Modal
        open={activeDocument.recoveryDraft !== null}
        title={t('resultRecoveryTitle')}
        closable={false}
        maskClosable={false}
        footer={[
          <Button key="disk" onClick={() => void discardRecoveryDraft()}>
            {t('resultRecoveryKeepDisk')}
          </Button>,
          <Button key="restore" type="primary" onClick={restoreRecoveryDraft}>
            {t('resultRecoveryRestore')}
          </Button>,
        ]}
      >
        <Alert
          type={activeDocument.recoveryDraft?.conflicted ? 'warning' : 'info'}
          showIcon
          title={
            activeDocument.recoveryDraft?.conflicted
              ? t('resultRecoveryConflict')
              : t('resultRecoveryDescription')
          }
        />
      </Modal>
      <ResultContentAdapter
        type={activeDocument.result.type}
        format={activeDocument.format}
        content={draftContent}
        editable={activeDocument.editable}
        viewMode={viewMode}
        onChange={updateDraft}
      />

      {exportOpen ? (
        <ExportResultModal
          key={activeDocument.result.id}
          document={activeDocument}
          onClose={() => setExportOpen(false)}
        />
      ) : null}

      <Modal
        open={diffOpen && comparison?.resultId === activeDocument.result.id}
        title={t('viewChanges')}
        footer={null}
        width={900}
        onCancel={() => {
          diffRequest.current++;
          setDiffOpen(false);
        }}
      >
        {comparison?.loading ? (
          <Skeleton active />
        ) : comparison?.error ? (
          <Alert type="error" showIcon title={t('resultChangesLoadFailed')} />
        ) : comparison?.before === null ? (
          <Empty description={t('resultNoPreviousChanges')} />
        ) : comparison ? (
          <>
            <p>{t(comparison.saved ? 'resultSavedChanges' : 'resultDraftChanges')}</p>
            <div className={styles.diffGrid}>
              <div>
                <strong>{t('before')}</strong>
                <pre>{comparison.before}</pre>
              </div>
              <div>
                <strong>{t('after')}</strong>
                <pre>{comparison.after}</pre>
              </div>
            </div>
          </>
        ) : null}
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
