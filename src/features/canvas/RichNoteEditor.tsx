import { useEffect, useRef, type ClipboardEvent, type MouseEvent } from 'react';
import type { CanvasBlock, CanvasNoteStyle } from '../../shared/types/canvas';
import styles from './RichNoteEditor.module.css';

import { noteHtml, sanitizeNoteHtml } from './richNoteHtml';

const groups = [
  { label: '加粗', command: 'bold', text: 'B', className: styles.bold },
  { label: '斜体', command: 'italic', text: 'I', className: styles.italic },
  { label: '下划线', command: 'underline', text: 'U', className: styles.underline },
  { label: '删除线', command: 'strikeThrough', text: 'S', className: styles.strike },
];

export function RichNoteEditor({
  block,
  onPatch,
  onDone,
}: {
  block: CanvasBlock;
  onPatch: (patch: Partial<CanvasBlock>) => void;
  onDone: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = noteHtml(block);
    // The editor owns its DOM while typing so React updates do not move the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);
  const remember = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode))
      selectionRef.current = selection.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    editorRef.current?.focus();
    if (!selectionRef.current) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectionRef.current);
  };
  const persist = () => {
    if (editorRef.current)
      onPatch({ body: sanitizeNoteHtml(editorRef.current.innerHTML), noteFormat: 'rich' });
    remember();
  };
  const command = (name: string, value?: string) => {
    restore();
    document.execCommand(name, false, value);
    persist();
  };
  const retainSelection = (event: MouseEvent) => {
    remember();
    event.preventDefault();
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    persist();
  };
  const updateStyle = (patch: Partial<CanvasNoteStyle>) =>
    onPatch({ noteStyle: { ...block.noteStyle, ...patch } });
  return (
    <div className={styles.editor}>
      <div className={styles.toolbar} role="toolbar" aria-label="笔记格式工具栏">
        <div className={styles.group}>
          {groups.map((tool) => (
            <button
              key={tool.command}
              type="button"
              aria-label={tool.label}
              title={tool.label}
              className={tool.className}
              onMouseDown={retainSelection}
              onClick={() => command(tool.command)}
            >
              {tool.text}
            </button>
          ))}
        </div>
        <div className={styles.group} aria-label="段落">
          <button
            type="button"
            aria-label="项目符号"
            title="项目符号"
            onMouseDown={retainSelection}
            onClick={() => command('insertUnorderedList')}
          >
            • 列表
          </button>
          <button
            type="button"
            aria-label="编号列表"
            title="编号列表"
            onMouseDown={retainSelection}
            onClick={() => command('insertOrderedList')}
          >
            1. 列表
          </button>
        </div>
        <div className={styles.group} aria-label="文字大小">
          {[
            ['2', '小'],
            ['3', '中'],
            ['4', '大'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-label={`${label}字号`}
              onMouseDown={retainSelection}
              onClick={() => command('fontSize', value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.group} aria-label="高亮颜色">
          <span className={styles.groupLabel}>高亮</span>
          {['#ffe38b', '#b7efc5', '#bde4ff', '#edc9f6'].map((color) => (
            <button
              key={color}
              type="button"
              className={styles.swatch}
              style={{ backgroundColor: color }}
              aria-label={`高亮 ${color}`}
              title="高亮选中文字"
              onMouseDown={retainSelection}
              onClick={() => command('hiliteColor', color)}
            />
          ))}
        </div>
        <div className={styles.group} aria-label="字体颜色">
          <span className={styles.groupLabel}>字色</span>
          {['#25324a', '#b93843', '#146f82', '#7049ad'].map((color) => (
            <button
              key={color}
              type="button"
              className={styles.swatch}
              style={{ backgroundColor: color }}
              aria-label={`字体颜色 ${color}`}
              title="设置选中文字颜色"
              onMouseDown={retainSelection}
              onClick={() => command('foreColor', color)}
            />
          ))}
        </div>
        <div className={styles.group} aria-label="便签底色">
          <span className={styles.groupLabel}>底色</span>
          {['#fff2b8', '#f8dcec', '#dceffc', '#e2f4df'].map((color) => (
            <button
              key={color}
              type="button"
              className={styles.swatch}
              style={{ backgroundColor: color }}
              aria-label={`笔记底色 ${color}`}
              onMouseDown={retainSelection}
              onClick={() => updateStyle({ background: color })}
            />
          ))}
        </div>
        <button
          type="button"
          className={styles.done}
          onMouseDown={retainSelection}
          onClick={onDone}
        >
          完成
        </button>
      </div>
      <div
        ref={editorRef}
        className={styles.content}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="笔记内容"
        aria-multiline="true"
        data-placeholder="在这里记录想法…"
        onInput={persist}
        onKeyUp={remember}
        onMouseUp={remember}
        onPaste={onPaste}
      />
    </div>
  );
}
