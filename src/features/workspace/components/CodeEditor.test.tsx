import { act, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { expect, it, vi } from 'vitest';
import { CodeEditor } from './CodeEditor';

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
