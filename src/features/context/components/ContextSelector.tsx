import { Alert, Button, Checkbox, Divider, Modal, Progress, Select, Tag } from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type {
  ContextManifest,
  ContextSelection,
  ProcessingLocation,
} from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { useImportStore } from '../../imports/importStore';
import {
  buildContextSnapshot,
  isSensitivePath,
  normalizeContextSelection,
} from '../contextSnapshot';
import styles from './ContextSelector.module.css';

interface Props {
  open: boolean;
  prompt: string;
  initialSelection: ContextSelection;
  confirmText?: string;
  manifest?: ContextManifest | null;
  planning?: boolean;
  indexClearing?: boolean;
  error?: string | null;
  processingLocation?: ProcessingLocation;
  reviewOnly?: boolean;
  onCancel: () => void;
  onPlan?: (selection: ContextSelection) => void;
  onInvalidateManifest?: () => void;
  onClearIndex?: () => void;
  onConfirm: (
    selection: ContextSelection,
    manifestId: string | null,
    sensitiveConfirmed: boolean
  ) => void;
}

export function ContextSelector({
  open,
  prompt,
  initialSelection,
  confirmText,
  manifest,
  planning = false,
  indexClearing = false,
  error,
  processingLocation = 'cloud',
  reviewOnly = false,
  onCancel,
  onPlan,
  onInvalidateManifest,
  onClearIndex,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  const files = useAppStore((state) => state.files);
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activePath = useAppStore((state) => state.activePath);
  const selectedText = useAppStore((state) => state.selectedText);
  const workspace = useAppStore((state) => state.workspace);
  const documentSources = useImportStore((state) => state.sources).filter(
    (source) => source.workspaceId === workspace?.id
  );
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false);
  const [selection, setSelection] = useState<ContextSelection>(() =>
    normalizeContextSelection(initialSelection, selectedText)
  );
  const recentMessages = useMemo(
    () => sessions.find((session) => session.id === activeSessionId)?.messages ?? [],
    [activeSessionId, sessions]
  );
  const snapshot = useMemo(
    () =>
      buildContextSnapshot({
        selection,
        files,
        activePath,
        selectedText,
        recentMessages,
        prompt,
      }),
    [activePath, files, prompt, recentMessages, selectedText, selection]
  );
  const selectedAuthorizedSources = useMemo(() => {
    const selectedIds = new Set(selection.documentSourceIds ?? []);
    const alreadyVisibleSourceIds = new Set(
      files
        .filter(
          (file) =>
            (selection.currentFile && file.path === activePath) ||
            selection.projectFiles.includes(file.path)
        )
        .flatMap((file) => (file.sourceId ? [file.sourceId] : []))
    );
    return documentSources.filter(
      (source) => selectedIds.has(source.id) && !alreadyVisibleSourceIds.has(source.id)
    );
  }, [activePath, documentSources, files, selection]);

  const updateSelection = (next: ContextSelection) => {
    setSelection(next);
    setSensitiveConfirmed(false);
    onInvalidateManifest?.();
  };
  const setFlag = (key: 'selection' | 'currentFile' | 'recentMessages', checked: boolean) =>
    updateSelection({ ...selection, [key]: checked });
  const requiresSensitiveConfirmation = manifest
    ? manifest.requiresSensitiveConfirmation
    : snapshot.warnings.some((warning) => warning.includes('possible secret'));
  const handleOk = () => {
    if (reviewOnly) {
      onConfirm(selection, null, true);
    } else if (!manifest) {
      onPlan?.(selection);
    } else {
      onConfirm(
        selection,
        manifest.id,
        sensitiveConfirmed || !manifest.requiresSensitiveConfirmation
      );
    }
  };

  return (
    <Modal
      open={open}
      title={t('contextTitle')}
      okText={
        reviewOnly
          ? (confirmText ?? t('saveContextSelection'))
          : manifest
            ? t('confirmAndSend')
            : t('buildSendManifest')
      }
      cancelText={t('cancel')}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={planning}
      okButtonProps={{
        disabled: Boolean(manifest && requiresSensitiveConfirmation && !sensitiveConfirmed),
      }}
      width={660}
    >
      <div className={styles.body}>
        <Alert
          type={processingLocation === 'cloud' ? 'warning' : 'info'}
          showIcon
          title={t(processingLocation === 'cloud' ? 'cloudProcessing' : 'localProcessing')}
          description={t('privacyHint')}
        />
        {error && <Alert type="error" showIcon title={error} />}
        <div className={styles.options}>
          <Checkbox
            disabled={selectedText.length === 0}
            checked={selection.selection}
            onChange={(event) => setFlag('selection', event.target.checked)}
          >
            {t('selection')}{' '}
            <Tag color={selectedText.length > 0 ? 'green' : 'default'}>
              {selectedText.length > 0 ? `${selectedText.length} chars` : t('noSelection')}
            </Tag>
          </Checkbox>
          <Checkbox
            checked={selection.currentFile}
            disabled={!activePath || isSensitivePath(activePath)}
            onChange={(event) => setFlag('currentFile', event.target.checked)}
          >
            {t('currentFile')} {activePath && <Tag color="blue">{activePath}</Tag>}
          </Checkbox>
          <Checkbox
            checked={selection.recentMessages}
            onChange={(event) => setFlag('recentMessages', event.target.checked)}
          >
            {t('recentMessages')}
          </Checkbox>
          <Select
            size="small"
            value={selection.recentMessageCount}
            disabled={!selection.recentMessages}
            aria-label={t('recentMessageCount')}
            options={[3, 5, 10, 20].map((count) => ({
              value: count,
              label: t('recentMessageCountValue').replace('{count}', String(count)),
            }))}
            onChange={(recentMessageCount) => updateSelection({ ...selection, recentMessageCount })}
          />
        </div>
        <Divider>{t('projectFiles')}</Divider>
        <Checkbox.Group
          value={selection.projectFiles}
          onChange={(paths) => updateSelection({ ...selection, projectFiles: paths as string[] })}
          className={styles.fileOptions}
        >
          {files
            .filter((file) => file.path !== activePath && !isSensitivePath(file.path))
            .map((file) => (
              <Checkbox value={file.path} key={file.path}>
                {file.path}
              </Checkbox>
            ))}
        </Checkbox.Group>
        {documentSources.length > 0 && (
          <>
            <Divider>{t('authorizedSources')}</Divider>
            <Checkbox.Group
              value={selection.documentSourceIds ?? []}
              onChange={(sourceIds) =>
                updateSelection({ ...selection, documentSourceIds: sourceIds as string[] })
              }
              className={styles.fileOptions}
            >
              {documentSources.map((source) => (
                <Checkbox value={source.id} key={source.id}>
                  {source.name}{' '}
                  <Tag>
                    {t(
                      source.kind === 'table'
                        ? 'sourceKindTable'
                        : source.kind === 'image'
                          ? 'sourceKindImage'
                          : 'sourceKindText'
                    )}
                  </Tag>
                </Checkbox>
              ))}
            </Checkbox.Group>
          </>
        )}
        <Divider>{t(manifest ? 'finalSendList' : 'selectionPreview')}</Divider>
        <div className={styles.sourceList}>
          {snapshot.sources.length === 0 &&
          selectedAuthorizedSources.length === 0 &&
          !selection.recentMessages ? (
            <Tag>{t('noFileContext')}</Tag>
          ) : (
            snapshot.sources.map((source) => (
              <Tag key={`${source.kind}:${source.label}`}>{source.label}</Tag>
            ))
          )}
          {selectedAuthorizedSources.map((source) => (
            <Tag key={`authorized:${source.id}`} color="cyan">
              {source.name}
            </Tag>
          ))}
          {selection.recentMessages && (
            <Tag color="purple">
              {t('recentMessageCountValue').replace(
                '{count}',
                String(selection.recentMessageCount)
              )}
            </Tag>
          )}
        </div>
        {!manifest && snapshot.warnings.length > 0 && (
          <Alert
            type="warning"
            showIcon
            title={t('sensitiveWarning')}
            description={snapshot.warnings.join('\n')}
          />
        )}
        {manifest && (
          <div className={styles.manifest}>
            <Divider>{t('trustedManifest')}</Divider>
            <Alert
              type="info"
              showIcon
              title={t(
                manifest.strategy === 'full'
                  ? 'contextStrategyFull'
                  : manifest.strategy === 'retrieval'
                    ? 'contextStrategyRetrieval'
                    : 'contextStrategyHybrid'
              )}
              description={
                manifest.indexMode === 'memory_lexical'
                  ? t('contextMemoryIndexDescription').replace(
                      '{count}',
                      String(manifest.retrievedChunkCount)
                    )
                  : t('contextFullDescription')
              }
            />
            <strong>{t('includedSources')}</strong>
            <div className={styles.manifestList}>
              {manifest.includedSources.length === 0 ? (
                <Tag>{t('noFileContext')}</Tag>
              ) : (
                manifest.includedSources.map((source) => (
                  <Tag color="green" key={`${source.kind}:${source.label}`}>
                    {source.label} · {source.characterCount.toLocaleString()} chars
                    {source.mode === 'retrieved'
                      ? ` · ${source.selectedRanges.length} ${t('contextChunks')}`
                      : ''}
                  </Tag>
                ))
              )}
            </div>
            {manifest.includedSources
              .filter((source) => source.mode === 'retrieved')
              .map((source) => (
                <div
                  className={styles.manifestRanges}
                  key={`ranges:${source.kind}:${source.label}`}
                >
                  <span>{t('contextSelectedRanges').replace('{source}', source.label)}</span>
                  <code>
                    {source.selectedRanges
                      .map(
                        (range) =>
                          `${range.chunkId} [${range.startCharacter.toLocaleString()}–${range.endCharacter.toLocaleString()}]`
                      )
                      .join(' · ')}
                  </code>
                </div>
              ))}
            <strong>{t('excludedSources')}</strong>
            <div className={styles.manifestExcluded}>
              {manifest.excludedSources.map((source) => (
                <span key={`${source.kind}:${source.label}`}>
                  {source.label}: {source.exclusionReason}
                </span>
              ))}
            </div>
            {onClearIndex && (
              <Button size="small" loading={indexClearing} onClick={onClearIndex}>
                {t('clearContextIndex')}
              </Button>
            )}
          </div>
        )}
        {manifest && requiresSensitiveConfirmation && (
          <Checkbox
            checked={sensitiveConfirmed}
            onChange={(event) => setSensitiveConfirmed(event.target.checked)}
          >
            {t('sensitiveConfirm')}
          </Checkbox>
        )}
        <div className={styles.tokens}>
          <span>
            {t('contextCharacters').replace(
              '{count}',
              (manifest?.characterCount ?? snapshot.characterCount).toLocaleString()
            )}
          </span>
          <strong>
            {t('tokenEstimate')}:{' '}
            {(manifest?.estimatedTokens ?? snapshot.estimatedTokens).toLocaleString()}
          </strong>
        </div>
        <Progress
          percent={Math.min(
            100,
            Math.round(
              ((manifest?.estimatedTokens ?? snapshot.estimatedTokens) /
                (manifest?.tokenBudget ?? 128000)) *
                100
            )
          )}
          showInfo={false}
          size="small"
        />
      </div>
    </Modal>
  );
}
