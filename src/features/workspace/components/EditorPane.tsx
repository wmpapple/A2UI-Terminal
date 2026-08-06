import { CloseOutlined, EyeInvisibleOutlined, EyeOutlined, SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Segmented, Space, Spin, Tag } from 'antd';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ExposeParam } from 'md-editor-rt';
import 'md-editor-rt/lib/style.css';
import { useI18n } from '../../../app/i18n/useI18n';
import type { CenterView } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { DiffReview } from '../../diff/components/DiffReview';
import styles from './EditorPane.module.css';

const MarkdownEditor = lazy(() =>
  import('md-editor-rt').then((module) => ({ default: module.MdEditor }))
);

export function EditorPane() {
  const { locale, t } = useI18n();
  const {
    runtimeMode,
    files,
    openPaths,
    activePath,
    dirtyPaths,
    saveStatusByPath,
    recoveryDrafts,
    centerView,
  } = useAppStore();
  const openFile = useAppStore((state) => state.openFile);
  const closeFile = useAppStore((state) => state.closeFile);
  const updateFile = useAppStore((state) => state.updateFile);
  const markSaved = useAppStore((state) => state.markSaved);
  const persistDraft = useAppStore((state) => state.persistDraft);
  const saveFileToDisk = useAppStore((state) => state.saveFileToDisk);
  const restoreRecoveryDraft = useAppStore((state) => state.restoreRecoveryDraft);
  const discardRecoveryDraft = useAppStore((state) => state.discardRecoveryDraft);
  const setCenterView = useAppStore((state) => state.setCenterView);
  const setSelectedText = useAppStore((state) => state.setSelectedText);
  const [previewByPath, setPreviewByPath] = useState<Record<string, boolean>>({});
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
      const signature = `${file.contentHash ?? ''}\0${file.content}`;
      const pending = timers.get(path);
      if (pending?.signature === signature) continue;
      if (pending) {
        window.clearTimeout(pending.draftTimer);
        window.clearTimeout(pending.diskTimer);
      }
      if (runtimeMode === 'desktop') {
        timers.set(path, {
          signature,
          draftTimer: window.setTimeout(() => void persistDraft(path), 250),
          diskTimer: window.setTimeout(() => void saveFileToDisk(path), 1000),
        });
      } else {
        const timer = window.setTimeout(() => markSaved(path), 1000);
        timers.set(path, { signature, draftTimer: timer, diskTimer: timer });
      }
    }
  }, [dirtyPaths, files, markSaved, persistDraft, runtimeMode, saveFileToDisk]);

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
          ]}
        />
        <div className={styles.toolbarActions}>
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
          {isExtractedDocument ? <Tag color="purple">{t('readOnlyDocument')}</Tag> : null}
          {!isExtractedDocument ? <Tag color={saveColor}>{saveLabel}</Tag> : null}
        </div>
      </div>
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
          message={activeSaveStatus === 'conflict' ? t('recoveryTitle') : t('pendingDraftTitle')}
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
          <DiffReview />
        ) : activeFile && isMarkdown ? (
          <Suspense
            fallback={
              <div className={styles.loading}>
                <Spin />
              </div>
            }
          >
            <MarkdownEditor
              ref={bindMarkdownEditor}
              modelValue={activeFile.content}
              onChange={(value) => updateFile(activeFile.path, value)}
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
            <Alert type="info" showIcon message={t('documentContextHint')} />
            <pre>{activeFile.content}</pre>
          </article>
        ) : activeFile ? (
          <textarea
            className={styles.codeEditor}
            value={activeFile.content}
            spellCheck={false}
            aria-label={activeFile.path}
            onChange={(event) => updateFile(activeFile.path, event.target.value)}
          />
        ) : (
          <Empty description="Select a file" />
        )}
      </div>
    </main>
  );
}
