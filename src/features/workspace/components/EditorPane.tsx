import { InfoNotice } from '../../../shared/components/InfoNotice';
import { userFacingError } from '../../../shared/errors/userFacingError';
import {
  HistoryOutlined,
  LayoutOutlined,
  FileOutlined,
  MoreOutlined,
  PaperClipOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { Alert, Button, Empty, Popover, Segmented, Space, Spin, Tooltip } from 'antd';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ExposeParam } from 'md-editor-rt';
import 'md-editor-rt/lib/style.css';
import { useI18n } from '../../../app/i18n/useI18n';
import type { CenterView } from '../../../shared/types/domain';
import type { DocumentSnapshot } from '../../../shared/types/document';
import { useAppStore } from '../../../stores/useAppStore';
import { useImportStore } from '../../imports/importStore';
import { A2uiWorkbench } from '../../a2ui/inspector/A2uiWorkbench';
import { DiffReview } from '../../diff/components/DiffReview';
import { SelectionAssistant } from '../../selection/components/SelectionAssistant';
import { BoundSceneTools } from '../../sceneTools/BoundSceneTools';
import { CriticPanel } from '../../critic/CriticPanel';
import { StructuredDocumentPanel } from '../../structuredDocument/StructuredDocumentPanel';
import { EmptyIllustration } from '../../../shared/components/EmptyIllustration';
import { WorkbenchAppearanceControl } from '../../../app/WorkbenchAppearanceControl';
import { useSystemTheme } from '../../../app/useSystemTheme';
import styles from './EditorPane.module.css';
import { CodeEditor } from './CodeEditor';
import { WorkspacePanelControls } from '../../../app/WorkspacePanelControls';
import { WorkItemTabs } from '../../../app/WorkItemTabs';
import { WorkItemHeader, WorkItemNavigation } from '../../../app/WorkItemFrame';
import {
  codeMirrorSelection,
  textHash,
  type SourceEditorPort,
} from '../../selection/editorAdapter';

const MarkdownEditor = lazy(() =>
  import('md-editor-rt').then((module) => ({ default: module.MdEditor }))
);
const VersionHistoryDrawer = lazy(() =>
  import('./VersionHistoryDrawer').then((module) => ({ default: module.VersionHistoryDrawer }))
);

const preserveEmptyMarkdown = (current: string, next: string) =>
  current.length === 0 && next.trim().length === 0 ? current : next;

interface EditorPaneProps {
  workItemTabs?: ReactNode;
  leftPanelLabels?: [string, string];
  showInspector?: boolean;
  showSimpleFileActions?: boolean;
  onOpenResult?: (resultId: string) => void;
  onOpenTool?: (id: string) => void;
  onOpenCanvas?: (path: string) => void;
  onEditorPort?: (port: SourceEditorPort | null) => void;
}

export function EditorPane({
  workItemTabs,
  leftPanelLabels,
  showInspector = true,
  showSimpleFileActions = false,
  onOpenResult,
  onOpenTool,
  onOpenCanvas,
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
  useEffect(() => {
    if (!showInspector && centerView === 'surface') setCenterView('editor');
  }, [centerView, setCenterView, showInspector]);
  const setSelectedText = useAppStore((state) => state.setSelectedText);
  const selectedText = useAppStore((state) => state.selectedText);
  const undoLastPatch = useAppStore((state) => state.undoLastPatch);
  const [viewByPath, setViewByPath] = useState<Record<string, 'edit' | 'split' | 'preview'>>({});
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [inlineEditorPort, setInlineEditorPort] = useState<SourceEditorPort | null>(null);
  const [webContentHash, setWebContentHash] = useState('');
  const editorRegionRef = useRef<HTMLDivElement>(null);
  const markdownEditorRef = useRef<ExposeParam | null>(null);
  const markdownViewRef = useRef({ preview: false, previewOnly: false });
  const autosaveTimersRef = useRef(
    new Map<string, { signature: string; draftTimer: number; diskTimer: number }>()
  );
  const activeFile = files.find((file) => file.path === activePath);
  const isMarkdown = activeFile?.language === 'markdown';
  const editorView = isMarkdown && activeFile ? (viewByPath[activeFile.path] ?? 'edit') : 'edit';
  const previewEnabled = editorView !== 'edit';
  const previewOnly = editorView === 'preview';
  const chatRequestId = useAppStore((state) => state.chatRequestId);
  const pendingDiff = useAppStore((state) => state.pendingDiff);
  const activeSaveStatus = activeFile ? (saveStatusByPath[activeFile.path] ?? 'saved') : 'saved';
  const recoveryDraft = activeFile ? recoveryDrafts[activeFile.path] : undefined;
  const isExtractedDocument = activeFile?.extracted === true;

  useEffect(() => {
    if (runtimeMode !== 'web-mock' || !activeFile) return;
    let current = true;
    void textHash(activeFile.content).then((hash) => {
      if (current) setWebContentHash(hash);
    });
    return () => {
      current = false;
    };
  }, [activeFile, runtimeMode]);

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
    editor?.togglePreview(markdownViewRef.current.preview);
    editor?.togglePreviewOnly?.(markdownViewRef.current.previewOnly);
  }, []);

  const publishEditorPort = useCallback(
    (port: SourceEditorPort | null) => {
      setInlineEditorPort(port);
      onEditorPort?.(port);
    },
    [onEditorPort]
  );

  useEffect(() => {
    if (!isMarkdown) {
      // The editor lifecycle publishes an imperative selection port.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!activeFile || isExtractedDocument) publishEditorPort(null);
      return;
    }
    publishEditorPort({
      read: () => {
        // Do not map selections in the rendered preview back to Markdown source.
        if (previewOnly || workspaceLoading || activeFile?.editable === false) return null;
        const anchor = document.getSelection()?.anchorNode;
        const element = anchor instanceof Element ? anchor : anchor?.parentElement;
        if (element?.closest('.md-editor-preview-wrapper')) return null;
        return codeMirrorSelection(markdownEditorRef.current?.getEditorView());
      },
    });
    return () => publishEditorPort(null);
  }, [
    activeFile,
    isMarkdown,
    isExtractedDocument,
    previewOnly,
    workspaceLoading,
    publishEditorPort,
  ]);

  const inlineSnapshot: DocumentSnapshot | null =
    activeFile &&
    (workspace || runtimeMode === 'web-mock') &&
    (activeFile.contentHash || webContentHash)
      ? {
          target: {
            kind: 'workspace_file',
            workspaceId: workspace?.id ?? 'web-mock-workspace',
            sourceId:
              activeFile.documentId ??
              activeFile.sourceId ??
              '00000000-0000-0000-0000-000000000001',
          },
          revisionId: null,
          contentHash: activeFile.contentHash ?? webContentHash,
          format: activeFile.language,
          text: activeFile.content,
          editable: activeFile.editable !== false && !activeFile.extracted,
          hasUnsavedDraft: activeSaveStatus !== 'saved' || Boolean(recoveryDraft),
        }
      : null;

  const receiveInlineApplication = useCallback(
    (application: import('../../../shared/types/domain').ReviewApplication) => {
      useAppStore.setState((state) => {
        const beforeByPath = Object.fromEntries(
          application.files.map((applied) => [
            applied.path,
            state.files.find((file) => file.path === applied.path)?.content ?? '',
          ])
        );
        return {
          files: state.files.map((file) => {
            const applied = application.files.find((item) => item.path === file.path);
            return applied
              ? { ...file, content: applied.content, contentHash: applied.contentHash }
              : file;
          }),
          dirtyPaths: state.dirtyPaths.filter(
            (path) => !application.files.some((file) => file.path === path)
          ),
          saveStatusByPath: Object.fromEntries([
            ...Object.entries(state.saveStatusByPath),
            ...application.files.map((file) => [file.path, 'saved' as const]),
          ]),
          lastPatchApplication: application.operationId
            ? {
                operationId: application.operationId,
                summary: '选区内 AI 修改',
                undoOf: null,
                files: application.files,
              }
            : null,
          lastReviewApplication: application,
          patchBeforeByPath: beforeByPath,
          selectedText: '',
        };
      });
    },
    []
  );

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

  useLayoutEffect(() => {
    markdownViewRef.current = { preview: previewEnabled, previewOnly };
    markdownEditorRef.current?.togglePreview(previewEnabled);
    markdownEditorRef.current?.togglePreviewOnly?.(previewOnly);
  }, [activePath, previewEnabled, previewOnly]);

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
      setViewByPath((current) => ({ ...current, [activePath]: 'edit' }));
    };
    window.addEventListener('keydown', closePreview);
    return () => window.removeEventListener('keydown', closePreview);
  }, [activePath, previewEnabled]);

  return (
    <main className={styles.pane}>
      {workItemTabs ?? (
        <WorkItemTabs
          items={openPaths.map((path) => ({
            id: path,
            type: 'document',
            title: path.split('/').at(-1) ?? path,
            status: dirtyPaths.includes(path) ? 'dirty' : 'saved',
          }))}
          activeId={activePath}
          onSelect={(item) => openFile(item.id)}
          onClose={(item) => closeFile(item.id)}
        />
      )}
      <WorkItemHeader
        icon={<FileOutlined />}
        title={activeFile?.name || activePath.split('/').at(-1) || t('editor')}
        type={`${locale === 'zh-CN' ? '文件' : 'File'} · ${isMarkdown ? 'Markdown' : (activeFile?.language?.toUpperCase() ?? '')}`}
        status={activeFile ? (isExtractedDocument ? t('readOnlyDocument') : saveLabel) : undefined}
        tone={saveColor === 'green' ? 'success' : saveColor === 'red' ? 'danger' : 'warning'}
        details={
          activeFile
            ? t(chatRequestId ? 'aiGenerating' : pendingDiff ? 'aiPendingReview' : 'aiIdle')
            : undefined
        }
        actions={<WorkspacePanelControls leftLabels={leftPanelLabels} />}
      />
      <WorkItemNavigation
        actions={
          <div className={styles.toolbarActions}>
            {activePath && onOpenCanvas && (
              <Button
                size="small"
                icon={<LayoutOutlined />}
                onClick={() => onOpenCanvas(activePath)}
              >
                打开画布
              </Button>
            )}
            <Popover
              trigger="click"
              placement="bottomRight"
              content={<WorkbenchAppearanceControl />}
            >
              <Tooltip title={t('quickControls')}>
                <Button
                  type="text"
                  size="small"
                  aria-label={t('quickControls')}
                  icon={<MoreOutlined />}
                />
              </Tooltip>
            </Popover>
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
          </div>
        }
      >
        <Segmented
          data-testid="workspace-mode"
          value={centerView}
          onChange={(value) => setCenterView(value as CenterView)}
          options={[
            {
              label: isExtractedDocument ? (locale === 'zh-CN' ? '阅读' : 'Read') : t('editMode'),
              value: 'editor',
            },
            { label: t('reviewMode'), value: 'diff' },
            ...(showInspector
              ? [{ label: locale === 'zh-CN' ? '交互视图' : 'Interactive view', value: 'surface' }]
              : []),
          ]}
        />
      </WorkItemNavigation>
      {showSimpleFileActions && workspaceError ? (
        <Alert
          closable
          type="error"
          showIcon
          title={userFacingError(workspaceError, locale)}
          onClose={clearWorkspaceError}
        />
      ) : null}
      {patchError && centerView !== 'diff' ? (
        <Alert type="error" showIcon title={userFacingError(patchError, locale)} />
      ) : null}
      {centerView === 'editor' && activeFile?.editable !== false && !previewOnly ? (
        <SelectionAssistant
          floating
          editorRegion={editorRegionRef}
          editorPort={inlineEditorPort}
          snapshot={inlineSnapshot}
          selectedText={selectedText}
          targetLabel={activeFile?.path ?? ''}
          onApplied={receiveInlineApplication}
        />
      ) : null}
      {centerView === 'editor' && activeFile && (
        <div className={styles.fileCapabilities}>
          {isMarkdown && (
            <Segmented
              size="small"
              value={editorView}
              options={[
                { label: t('editView'), value: 'edit' },
                { label: t('splitView'), value: 'split' },
                { label: t('previewView'), value: 'preview' },
              ]}
              onChange={(value) =>
                setViewByPath((current) => ({
                  ...current,
                  [activePath]: value as 'edit' | 'split' | 'preview',
                }))
              }
            />
          )}
          <div className={styles.contextCapabilities}>
            {centerView === 'editor' &&
            inlineSnapshot &&
            onOpenResult &&
            ['markdown', 'text', 'plaintext'].includes(inlineSnapshot.format) ? (
              <BoundSceneTools
                compact
                binding={{ type: 'document', target: inlineSnapshot.target }}
                dirty={inlineSnapshot.hasUnsavedDraft}
                onOpenResult={onOpenTool ?? onOpenResult}
              />
            ) : null}
            {centerView === 'editor' && (
              <CriticPanel
                compact
                snapshot={inlineSnapshot}
                workspaceId={workspace?.id ?? 'web-mock-workspace'}
                onApplied={receiveInlineApplication}
              />
            )}
            {centerView === 'editor' && (
              <StructuredDocumentPanel
                compact
                snapshot={inlineSnapshot}
                onApplied={receiveInlineApplication}
              />
            )}
          </div>
        </div>
      )}
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
              toolbars={[
                'bold',
                'italic',
                'underline',
                'strikeThrough',
                '-',
                'title',
                'unorderedList',
                'orderedList',
                'quote',
                '-',
                'link',
                'image',
                'table',
                'code',
                '-',
                'revoke',
                'next',
              ]}
              toolbarsExclude={[
                'github',
                'save',
                'catalog',
                'preview',
                'previewOnly',
                'htmlPreview',
              ]}
              className={`${styles.editor} ${previewOnly ? styles.previewOnly : ''}`}
            />
          </Suspense>
        ) : activeFile && isExtractedDocument ? (
          <article className={styles.documentPreview} aria-label={activeFile.path}>
            <InfoNotice type="info" showIcon title={t('documentContextHint')} />
            <pre>{activeFile.content}</pre>
          </article>
        ) : activeFile ? (
          <CodeEditor
            key={JSON.stringify([workspace?.id, activeFile.sourceId, activeFile.path])}
            path={activeFile.path}
            value={activeFile.content}
            disabled={workspaceLoading || activeFile.editable === false}
            onSelection={setSelectedText}
            onEditorPort={publishEditorPort}
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
