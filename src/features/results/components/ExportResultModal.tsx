import { InfoNotice } from '../../../shared/components/InfoNotice';
import { Alert, Button, Modal, Progress, Select } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { MessageKey } from '../../../app/i18n/messages';
import { isWebMock } from '../../../shared/platform/runtime';
import type { ExportFormat, ExportStage, ResultDocument } from '../../../shared/types/domain';
import { resultController } from '../resultController';
import { useResultStore } from '../resultStore';
import { exportExtension, exportFormatsFor } from '../../../shared/types/exportFormats';

export function ExportResultModal({
  document,
  onClose,
}: {
  document: ResultDocument;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const formats = exportFormatsFor(document.result.type, document.format);
  const [format, setFormat] = useState<ExportFormat>(formats.includes('pdf') ? 'pdf' : formats[0]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ExportStage | null>(null);
  const [percent, setPercent] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const running = useRef(false);
  const exportId = useRef<string | null>(null);
  const mounted = useRef(true);
  const cancelled = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelled.current = true;
      if (exportId.current)
        void resultController.cancelExport(exportId.current).catch(() => undefined);
    };
  }, []);

  const run = async () => {
    if (running.current) return;
    running.current = true;
    cancelled.current = false;
    setBusy(true);
    setError(null);
    setStage(null);
    setFileName(null);
    setPercent(0);
    setCancelling(false);
    try {
      const before = useResultStore.getState();
      if (before.activeDocument?.result.id !== document.result.id)
        throw new Error(t('exportRevisionUnavailable'));
      if (before.saving) throw new Error(t('exportSaveRequired'));
      if (before.draftContent !== before.activeDocument.content) await before.save();
      if (!mounted.current) return;
      if (cancelled.current) {
        setStage('cancelled');
        return;
      }
      const current = useResultStore.getState();
      const saved = current.activeDocument;
      const revisionId = saved?.result.currentRevisionId;
      if (!saved || saved.result.id !== document.result.id || !revisionId)
        throw new Error(t('exportRevisionUnavailable'));
      if (current.saving || current.draftContent !== saved.content)
        throw new Error(t('exportSaveRequired'));
      const id = crypto.randomUUID();
      exportId.current = id;
      setStage('preparing');
      const result = await resultController.export(
        { exportId: id, resultId: saved.result.id, revisionId, format },
        (event) => {
          if (!mounted.current || event.exportId !== exportId.current) return;
          setStage(event.stage);
          setPercent(event.progress);
          // Handles cancellation requested before Rust registered the job.
          if (cancelled.current) void resultController.cancelExport(id).catch(() => undefined);
        }
      );
      if (!mounted.current) return;
      setStage(result.status);
      setPercent(100);
      setFileName(result.fileName);
    } catch (reason) {
      if (!mounted.current) return;
      const detail = reason as { code?: string; message?: string };
      setError(
        detail?.code === 'FILESYSTEM_ERROR'
          ? t('exportDestinationUnavailable')
          : detail?.code === 'FILE_CONFLICT'
            ? t('exportConflict')
            : (detail?.message ?? t('exportFailed'))
      );
      setStage('failed');
    } finally {
      exportId.current = null;
      running.current = false;
      if (mounted.current) {
        setBusy(false);
        setCancelling(false);
      }
    }
  };

  const cancel = async () => {
    cancelled.current = true;
    setCancelling(true);
    if (!exportId.current) return;
    try {
      await resultController.cancelExport(exportId.current);
    } catch {
      if (mounted.current) {
        setError(t('exportCancelFailed'));
        setCancelling(false);
      }
    }
  };

  return (
    <Modal
      open
      title={t('exportResult')}
      onCancel={() => {
        if (busy) void cancel();
        else onClose();
      }}
      footer={[
        <Button
          key="cancel"
          disabled={cancelling}
          onClick={() => {
            if (busy) void cancel();
            else onClose();
          }}
        >
          {busy ? t('cancelExport') : t('close')}
        </Button>,
        <Button
          key="export"
          type="primary"
          loading={busy}
          disabled={busy}
          onClick={() => void run()}
        >
          {error ? t('retryExport') : t('startExport')}
        </Button>,
      ]}
    >
      <p>{t('exportRevisionBound')}</p>
      <p>{t('exportFormatLimit')}</p>
      {isWebMock() ? <InfoNotice type="info" showIcon title={t('exportMockNotice')} /> : null}
      <Select
        aria-label={t('exportFormatLabel')}
        value={format}
        disabled={busy}
        style={{ width: '100%' }}
        options={formats.map((value) => ({ label: exportExtension(value).toUpperCase(), value }))}
        onChange={setFormat}
      />
      {stage ? (
        <div style={{ marginTop: 16 }}>
          <Progress
            percent={percent}
            status={stage === 'failed' || stage === 'cancelled' ? 'exception' : undefined}
          />
          <p data-testid="export-status">{t(`exportStage_${stage}` as MessageKey)}</p>
        </div>
      ) : null}
      {cancelling ? <p>{t('exportCancelling')}</p> : null}
      {fileName ? (
        <Alert
          type="success"
          showIcon
          title={t(isWebMock() ? 'exportMockCompleted' : 'exportCompleted')}
          description={fileName}
        />
      ) : null}
      {error ? <Alert type="error" showIcon title={t('exportFailed')} description={error} /> : null}
    </Modal>
  );
}
