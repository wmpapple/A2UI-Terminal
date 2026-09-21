import { act, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { expect, it, vi } from 'vitest';
import { CodeEditor } from './CodeEditor';
import type { SourceEditorPort } from '../../selection/editorAdapter';

it('exposes real source positions and invalidates the port on unmount', () => {
  const onEditorPort = vi.fn<(port: SourceEditorPort | null) => void>();
  const { unmount } = render(
    <CodeEditor
      path="unicode.txt"
      value="中文🙂"
      disabled={false}
      onChange={vi.fn()}
      onSelection={vi.fn()}
      onEditorPort={onEditorPort}
    />
  );
  const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: 'unicode.txt' }))!;
  act(() => view.dispatch({ selection: { anchor: 2, head: 4 } }));
  expect(onEditorPort.mock.calls.at(-1)?.[0]?.read()).toEqual({ text: '中文🙂', start: 2, end: 4 });
  unmount();
  expect(onEditorPort).toHaveBeenLastCalledWith(null);
});

it('preserves editing, undo, external updates and read-only state', () => {
  const onChange = vi.fn();
  const onSelection = vi.fn();
  const props = { path: 'notes.txt', value: 'original', disabled: false, onChange, onSelection };
  const { rerender } = render(<CodeEditor {...props} />);
  const textbox = screen.getByRole('textbox', { name: 'notes.txt' });
  const view = EditorView.findFromDOM(textbox)!;
  act(() => view.dispatch({ changes: { from: 8, insert: ' edit' } }));
  expect(onChange).toHaveBeenLastCalledWith('original edit');
  act(() => {
    undo(view);
  });
  expect(onChange).toHaveBeenLastCalledWith('original');
  onChange.mockClear();
  rerender(<CodeEditor {...props} value="restored" disabled />);
  expect(view.state.doc.toString()).toBe('restored');
  expect(textbox).toHaveAttribute('contenteditable', 'false');
  expect(onChange).not.toHaveBeenCalled();
});
