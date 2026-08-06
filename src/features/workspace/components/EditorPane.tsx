import { CloseOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Empty, Segmented, Spin, Tag } from 'antd';
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
  const { files, openPaths, activePath, dirtyPaths, centerView } = useAppStore();
  const openFile = useAppStore((state) => state.openFile);
  const closeFile = useAppStore((state) => state.closeFile);
  const updateFile = useAppStore((state) => state.updateFile);
  const markSaved = useAppStore((state) => state.markSaved);
  const setCenterView = useAppStore((state) => state.setCenterView);
  const setSelectedText = useAppStore((state) => state.setSelectedText);
  const [previewByPath, setPreviewByPath] = useState<Record<string, boolean>>({});
  const editorRegionRef = useRef<HTMLDivElement>(null);
  const markdownEditorRef = useRef<ExposeParam | null>(null);
  const activeFile = files.find((file) => file.path === activePath);
  const isMarkdown = activeFile?.language === 'markdown';
  const previewEnabled = Boolean(
    isMarkdown && activeFile && (previewByPath[activeFile.path] ?? false)
  );

  const bindMarkdownEditor = useCallback((instance: unknown) => {
    const editor = instance as ExposeParam | null;
    markdownEditorRef.current = editor;
  }, []);

  useEffect(() => {
    if (!activeFile || !dirtyPaths.includes(activeFile.path)) return;
    const timer = window.setTimeout(() => markSaved(activeFile.path), 1000);
    return () => window.clearTimeout(timer);
  }, [activeFile, dirtyPaths, markSaved]);

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
          <Tag color={activeFile && dirtyPaths.includes(activeFile.path) ? 'orange' : 'green'}>
            {activeFile && dirtyPaths.includes(activeFile.path) ? t('unsaved') : t('saved')}
          </Tag>
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
      <div className={styles.content} ref={editorRegionRef}>
        {centerView === 'diff' ? (
          <DiffReview />
        ) : activeFile ? (
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
        ) : (
          <Empty description="Select a file" />
        )}
      </div>
    </main>
  );
}
