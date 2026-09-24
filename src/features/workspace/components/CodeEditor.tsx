import { useLayoutEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';
import styles from './CodeEditor.module.css';
import { codeMirrorSelection, type SourceEditorPort } from '../../selection/editorAdapter';

interface Props {
  path: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSelection: (value: string) => void;
  onEditorPort?: (port: SourceEditorPort | null) => void;
}

const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.variableName], color: 'var(--text-strong)' },
  { tag: tags.string, color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.keyword], color: 'var(--accent)' },
  { tag: [tags.comment, tags.punctuation], color: 'var(--text-muted)' },
  { tag: [tags.typeName, tags.function(tags.variableName)], color: 'var(--code-function)' },
]);

export function CodeEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  const editable = useRef(new Compartment());
  const onEditorPort = props.onEditorPort;
  useLayoutEffect(() => {
    latest.current = props;
  });

  useLayoutEffect(() => {
    onEditorPort?.({
      read: () => (latest.current.disabled ? null : codeMirrorSelection(view.current ?? undefined)),
    });
    return () => onEditorPort?.(null);
  }, [onEditorPort]);

  useLayoutEffect(() => {
    if (!host.current) return;
    const language = new Compartment();
    let active = true;
    let syncing = false;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          lineNumbers(),
          drawSelection(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(highlight),
          language.of([]),
          editable.current.of([
            EditorState.readOnly.of(latest.current.disabled),
            EditorView.editable.of(!latest.current.disabled),
          ]),
          EditorView.contentAttributes.of({
            'aria-label': latest.current.path,
            spellcheck: 'false',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing) latest.current.onChange(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) {
              const { from, to } = update.state.selection.main;
              latest.current.onSelection(update.state.sliceDoc(from, to));
            }
          }),
        ],
      }),
    });
    view.current = editor;
    // External updates (reload/restore) must not echo back as user edits.
    const sync = (value: string) => {
      if (editor.state.doc.toString() === value) return;
      syncing = true;
      try {
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
      } finally {
        syncing = false;
      }
    };
    syncValue.current = sync;
    const support = LanguageDescription.matchFilename(languages, latest.current.path);
    if (support)
      void support
        .load()
        .then((extension) => {
          if (active) editor.dispatch({ effects: language.reconfigure(extension) });
        })
        .catch(() => {
          /* Plain text remains editable if a language chunk cannot load. */
        });
    return () => {
      active = false;
      syncValue.current = null;
      view.current = null;
      editor.destroy();
    };
  }, []);

  const syncValue = useRef<((value: string) => void) | null>(null);
  useLayoutEffect(() => {
    syncValue.current?.(props.value);
  }, [props.value]);
  useLayoutEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(props.disabled),
        EditorView.editable.of(!props.disabled),
      ]),
    });
  }, [props.disabled]);
  return <div ref={host} className={styles.editor} />;
}
