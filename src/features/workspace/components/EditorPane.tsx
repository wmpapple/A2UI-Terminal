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
import { useImportStore } from '../../imports/importStore';
import { A2uiWorkbench } from '../../a2ui/inspector/A2uiWorkbench';
import { DiffReview } from '../../diff/components/DiffReview';
import { SelectionAssistant } from '../../selection/components/SelectionAssistant';
import { EmptyIllustration } from '../../../shared/components/EmptyIllustration';
import { WorkbenchAppearanceControl } from '../../../app/WorkbenchAppearanceControl';
import { useSystemTheme } from '../../../app/useSystemTheme';
import styles from './EditorPane.module.css';
import { CodeEditor } from './CodeEditor';
import { codeMirrorSelection, type SourceEditorPort } from '../../selection/editorAdapter';

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
  onEditorPort?: (port: SourceEditorPort | null) => void;
}

export function EditorPane({
  showInspector = true,
  showSimpleFileActions = false,
  onOpenResult,
  onEditorPort,
}: EditorPaneProps) {
  const dark = useSystemTheme();
  const { locale, t } = useI18n();
  const runtimeMode = useAppStore((state) => state.runtimeMode);
  const workspace = useAppStore((state) => state.workspace);
  const files = useAppStore((state) => state.files);
  const openPaths = useAppStore((state) => state.openPaths);
  const activePath = useAppStore((state) => state.activePath);
  const dirtyPaths = useAppStore((state) => state.dirtyPaths);
  const saveStatusByPath = useAppStore((state) => state.saveStatusByPath);
  const workspaceLoading = useAppStore((state) => state.workspaceLoading);
  const workspaceError = useAppStore((state) => state.workspaceError);
  const recoveryDrafts = useAppStore((state) => state.recoveryDrafts);
  const centerView = useAppStore((state) => state.centerView);
  const lastPatchApplication = useAppStore((state) => state.lastPatchApplication);
  const lastReviewApplication = useAppStore((state) => state.lastReviewApplication);
  const patchApplying = useAppStore((state) => state.patchApplying);
  const patchError = useAppStore((state) => state.patchError);
  const openFile = useAppStore((state) => state.openFile);
  const selectImportSources = useImportStore((state) => state.select);
  const selectContextFiles = () => selectImportSources(workspace?.id);
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
    if (!isMarkdown) {
      if (!activeFile || isExtractedDocument) onEditorPort?.(null);
      return;
    }
    onEditorPort?.({
      read: () => {
        // Do not map selections in the rendered preview back to Markdown source.
        if (previewEnabled || workspaceLoading || activeFile?.editable === false) return null;
        return codeMirrorSelection(markdownEditorRef.current?.getEditorView());
      },
    });
    return () => onEditorPort?.(null);
  }, [activeFile, isMarkdown, isExtractedDocument, previewEnabled, workspaceLoading, onEditorPort]);

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

  useEffect(() => {
    if (!previewEnabled) return;
    const closePreview = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.isComposing ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"]')
      )
        return;
      setPreviewByPath((current) => ({ ...current, [activePath]: false }));
    };
    window.addEventListener('keydown', closePreview);
    return () => window.removeEventListener('keydown', closePreview);
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
          <WorkbenchAppearanceControl />
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
          {!isExtractedDocument ? (
            <Tag className={styles.saveStatus} data-tone={saveColor}>
              {saveLabel}
            </Tag>
          ) : null}
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
      {centerView === 'editor' && activeFile?.editable !== false && !previewEnabled ? (
        <SelectionAssistant />
      ) : null}
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
              theme={dark ? 'dark' : 'light'}
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
          <CodeEditor
            key={JSON.stringify([workspace?.id, activeFile.sourceId, activeFile.path])}
            path={activeFile.path}
            value={activeFile.content}
            disabled={workspaceLoading || activeFile.editable === false}
            onSelection={setSelectedText}
            onEditorPort={onEditorPort}
            onChange={(value) => updateFile(activeFile.path, value, workspace?.id)}
          />
        ) : (
          <Empty
            className={styles.empty}
            image={<EmptyIllustration />}
            styles={{ image: { height: 140 } }}
            description={t('selectFilePrompt')}
          >
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
