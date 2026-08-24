import {
  CloseOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  HistoryOutlined,
  PaperClipOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { Alert, Button, Empty, Segmented, Space, Spin, Tag } from 'antd';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ExposeParam } from 'md-editor-rt';
import 'md-editor-rt/lib/style.css';
import { useI18n } from '../../../app/i18n/useI18n';
import type { CenterView } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { A2uiWorkbench } from '../../a2ui/inspector/A2uiWorkbench';
import { DiffReview } from '../../diff/components/DiffReview';
import styles from './EditorPane.module.css';

const MarkdownEditor = lazy(() =>
  import('md-editor-rt').then((module) => ({ default: module.MdEditor }))
);
const VersionHistoryDrawer = lazy(() =>
  import('./VersionHistoryDrawer').then((module) => ({ default: module.VersionHistoryDrawer }))
);

const preserveEmptyMarkdown = (current: string, next: string) =>
  current.length === 0 && next.trim().length === 0 ? current : next;

interface EditorPaneProps {
  showInspector?: boolean;
  showSimpleFileActions?: boolean;
  onOpenResult?: (resultId: string) => void;
}

export function EditorPane({
  showInspector = true,
  showSimpleFileActions = false,
  onOpenResult,
}: EditorPaneProps) {
  const { locale, t } = useI18n();
  const {
    runtimeMode,
    workspace,
    files,
    openPaths,
    activePath,
    dirtyPaths,
    saveStatusByPath,
    workspaceLoading,
    workspaceError,
    recoveryDrafts,
    centerView,
    lastPatchApplication,
    lastReviewApplication,
    patchApplying,
    patchError,
  } = useAppStore();
  const openFile = useAppStore((state) => state.openFile);
  const selectContextFiles = useAppStore((state) => state.selectContextFiles);
  const clearWorkspaceError = useAppStore((state) => state.clearWorkspaceError);
  const closeFile = useAppStore((state) => state.closeFile);
  const updateFile = useAppStore((state) => state.updateFile);
  const markSaved = useAppStore((state) => state.markSaved);
  const persistDraft = useAppStore((state) => state.persistDraft);
  const saveFileToDisk = useAppStore((state) => state.saveFileToDisk);
  const restoreRecoveryDraft = useAppStore((state) => state.restoreRecoveryDraft);
  const discardRecoveryDraft = useAppStore((state) => state.discardRecoveryDraft);
  const setCenterView = useAppStore((state) => state.setCenterView);
  const setSelectedText = useAppStore((state) => state.setSelectedText);
  const undoLastPatch = useAppStore((state) => state.undoLastPatch);
  const [previewByPath, setPreviewByPath] = useState<Record<string, boolean>>({});
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const editorRegionRef = useRef<HTMLDivElement>(null);
  const markdownEditorRef = useRef<ExposeParam | null>(null);
  const autosaveTimersRef = useRef(
    new Map<string, { signature: string; draftTimer: number; diskTimer: number }>()
  );
  const activeFile = files.find((file) => file.path === activePath);
  const isMarkdown = activeFile?.language === 'markdown';
  const previewEnabled = Boolean(
    isMarkdown && activeFile && (previewByPath[activeFile.path] ?? false)
  );
  const activeSaveStatus = activeFile ? (saveStatusByPath[activeFile.path] ?? 'saved') : 'saved';
  const recoveryDraft = activeFile ? recoveryDrafts[activeFile.path] : undefined;
  const isExtractedDocument = activeFile?.extracted === true;

  const saveLabel =
    activeSaveStatus === 'saving'
      ? t('saving')
      : activeSaveStatus === 'draft'
        ? t('draftSaved')
        : activeSaveStatus === 'conflict'
          ? t('saveConflict')
          : activeSaveStatus === 'error'
            ? t('saveFailed')
            : activeSaveStatus === 'dirty'
              ? t('unsaved')
              : t('saved');
  const saveColor =
    activeSaveStatus === 'conflict' || activeSaveStatus === 'error'
      ? 'red'
      : activeSaveStatus === 'saved'
        ? 'green'
        : activeSaveStatus === 'saving'
          ? 'blue'
          : 'orange';

  const bindMarkdownEditor = useCallback((instance: unknown) => {
    const editor = instance as ExposeParam | null;
    markdownEditorRef.current = editor;
  }, []);

  useEffect(() => {
    const timers = autosaveTimersRef.current;
    const dirtySet = new Set(dirtyPaths);
    const workspaceId = workspace?.id;

    if (workspaceLoading) {
      for (const pending of timers.values()) {
        window.clearTimeout(pending.draftTimer);
        window.clearTimeout(pending.diskTimer);
      }
      timers.clear();
      return;
    }

    for (const [path, pending] of timers) {
      if (!dirtySet.has(path)) {
        window.clearTimeout(pending.draftTimer);
        window.clearTimeout(pending.diskTimer);
        timers.delete(path);
      }
    }

    for (const path of dirtyPaths) {
      const file = files.find((item) => item.path === path);
      if (!file || file.editable === false) continue;
      const signature = `${workspaceId ?? ''}\0${file.contentHash ?? ''}\0${file.content}`;
      const pending = timers.get(path);
      if (pending?.signature === signature) continue;
      if (pending) {
        window.clearTimeout(pending.draftTimer);
        window.clearTimeout(pending.diskTimer);
      }
      if (runtimeMode === 'desktop') {
        timers.set(path, {
          signature,
          draftTimer: window.setTimeout(() => void persistDraft(path, workspaceId), 250),
          diskTimer: window.setTimeout(() => void saveFileToDisk(path, workspaceId), 1000),
        });
      } else {
        const timer = window.setTimeout(() => markSaved(path), 1000);
        timers.set(path, { signature, draftTimer: timer, diskTimer: timer });
      }
    }
  }, [
    dirtyPaths,
    files,
    markSaved,
    persistDraft,
    runtimeMode,
    saveFileToDisk,
    workspace?.id,
    workspaceLoading,
  ]);

  useEffect(
    () => () => {
      for (const pending of autosaveTimersRef.current.values()) {
        window.clearTimeout(pending.draftTimer);
        window.clearTimeout(pending.diskTimer);
      }
      autosaveTimersRef.current.clear();
    },
    []
  );

  useEffect(() => {
    const captureSelection = () => {
      const selection = document.getSelection();
      const anchor = selection?.anchorNode;
      if (!anchor || !editorRegionRef.current?.contains(anchor)) return;
      setSelectedText(selection.toString());
    };
    document.addEventListener('selectionchange', captureSelection);
    return () => document.removeEventListener('selectionchange', captureSelection);
  }, [setSelectedText]);

  useEffect(() => {
    markdownEditorRef.current?.togglePreview(previewEnabled);
  }, [activePath, previewEnabled]);

  const toggleMarkdownPreview = () => {
    if (!activeFile || !isMarkdown) return;
    const nextPreview = !previewEnabled;
    markdownEditorRef.current?.togglePreview(nextPreview);
    setPreviewByPath((current) => ({
      ...current,
      [activeFile.path]: nextPreview,
    }));
  };

  return (
    <main className={styles.pane}>
      <div className={styles.toolbar}>
        <Segmented
          value={centerView}
          onChange={(value) => setCenterView(value as CenterView)}
          options={[
            { label: t('editor'), value: 'editor' },
            { label: t('review'), value: 'diff' },
            { label: t(showInspector ? 'surface' : 'interactiveResult'), value: 'surface' },
          ]}
        />
        <div className={styles.toolbarActions}>
          {showSimpleFileActions ? (
            <Button
              size="small"
              type="primary"
              icon={<PaperClipOutlined />}
              loading={workspaceLoading}
              onClick={() => void selectContextFiles()}
            >
              {t('chooseFiles')}
            </Button>
          ) : null}
          {lastPatchApplication || lastReviewApplication ? (
            <Button
              size="small"
              icon={<UndoOutlined />}
              loading={patchApplying}
              onClick={() => void undoLastPatch()}
            >
              {t('undoPatch')}
            </Button>
          ) : null}
          {isMarkdown && activeFile ? (
            <Button
              size="small"
              type={previewEnabled ? 'primary' : 'default'}
              aria-label={previewEnabled ? t('hidePreview') : t('showPreview')}
              aria-pressed={previewEnabled}
              icon={previewEnabled ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={toggleMarkdownPreview}
            >
              {previewEnabled ? t('hidePreview') : t('showPreview')}
            </Button>
          ) : null}
          {activeFile && dirtyPaths.includes(activeFile.path) ? (
            <Button
              size="small"
              icon={<SaveOutlined />}
              loading={activeSaveStatus === 'saving'}
              onClick={() => void saveFileToDisk(activeFile.path)}
            >
              {t('saveNow')}
            </Button>
          ) : null}
          {runtimeMode === 'desktop' && activeFile && !isExtractedDocument ? (
            <Button
              size="small"
              icon={<HistoryOutlined />}
              aria-label={t('versionHistory')}
              onClick={() => setVersionHistoryOpen(true)}
            >
              {t('versionHistory')}
            </Button>
          ) : null}
          {isExtractedDocument ? <Tag color="purple">{t('readOnlyDocument')}</Tag> : null}
          {!isExtractedDocument ? <Tag color={saveColor}>{saveLabel}</Tag> : null}
        </div>
      </div>
      {showSimpleFileActions && workspaceError ? (
        <Alert
          closable
          type="error"
          showIcon
          title={workspaceError}
          onClose={clearWorkspaceError}
        />
      ) : null}
      {patchError && centerView !== 'diff' ? (
        <Alert type="error" showIcon title={patchError} />
      ) : null}
      <div className={styles.tabs} role="tablist">
        {openPaths.map((path) => (
          <div
            className={`${styles.tab} ${path === activePath ? styles.activeTab : ''}`}
            key={path}
          >
            <button
              type="button"
              role="tab"
              aria-selected={path === activePath}
              className={styles.tabSelect}
              onClick={() => openFile(path)}
            >
              <span>{path.split('/').at(-1)}</span>
            </button>
            <Button
              type="text"
              size="small"
              aria-label={`Close ${path}`}
              icon={<CloseOutlined />}
              onClick={() => closeFile(path)}
            />
          </div>
        ))}
      </div>
      {activeFile && recoveryDraft ? (
        <Alert
          type="warning"
          showIcon
          title={activeSaveStatus === 'conflict' ? t('recoveryTitle') : t('pendingDraftTitle')}
          description={
            activeSaveStatus === 'conflict'
              ? t('recoveryDescription')
              : t('pendingDraftDescription')
          }
          action={
            <Space direction="vertical">
              <Button size="small" onClick={() => restoreRecoveryDraft(activeFile.path)}>
                {t('restoreDraft')}
              </Button>
              <Button size="small" onClick={() => void discardRecoveryDraft(activeFile.path)}>
                {t('discardDraft')}
              </Button>
            </Space>
          }
        />
      ) : null}
      <div className={styles.content} ref={editorRegionRef}>
        {centerView === 'diff' ? (
          <DiffReview onOpenResult={onOpenResult} />
        ) : centerView === 'surface' ? (
          <A2uiWorkbench showInspector={showInspector} />
        ) : activeFile && isMarkdown ? (
          <Suspense
            fallback={
              <div className={styles.loading}>
                <Spin />
              </div>
            }
          >
            <MarkdownEditor
              key={`${workspace?.id ?? 'web-mock'}:${activeFile.sourceId ?? activeFile.path}`}
              ref={bindMarkdownEditor}
              modelValue={activeFile.content}
              onChange={(value) =>
                updateFile(
                  activeFile.path,
                  preserveEmptyMarkdown(activeFile.content, value),
                  workspace?.id
                )
              }
              disabled={workspaceLoading}
              language={locale}
              preview={previewEnabled}
              toolbarsExclude={[
                'github',
                'save',
                'catalog',
                'preview',
                'previewOnly',
                'htmlPreview',
              ]}
              className={styles.editor}
            />
          </Suspense>
        ) : activeFile && isExtractedDocument ? (
          <article className={styles.documentPreview} aria-label={activeFile.path}>
            <Alert type="info" showIcon title={t('documentContextHint')} />
            <pre>{activeFile.content}</pre>
          </article>
        ) : activeFile ? (
          <textarea
            className={styles.codeEditor}
            value={activeFile.content}
            disabled={workspaceLoading}
            spellCheck={false}
            aria-label={activeFile.path}
            onChange={(event) => updateFile(activeFile.path, event.target.value, workspace?.id)}
          />
        ) : (
          <Empty description={t('selectFilePrompt')}>
            {showSimpleFileActions ? (
              <Button
                type="primary"
                icon={<PaperClipOutlined />}
                loading={workspaceLoading}
                onClick={() => void selectContextFiles()}
              >
                {t('chooseFiles')}
              </Button>
            ) : null}
          </Empty>
        )}
      </div>
      {versionHistoryOpen ? (
        <Suspense fallback={null}>
          <VersionHistoryDrawer
            open
            path={activeFile?.path ?? ''}
            onClose={() => setVersionHistoryOpen(false)}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
