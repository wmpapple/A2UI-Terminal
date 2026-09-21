import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { ChatComposer } from './ChatComposer';

function setup(prompt = 'hello', requestActive = false) {
  const onSend = vi.fn();
  const onPromptChange = vi.fn();
  render(
    <I18nProvider>
      <ChatComposer
        prompt={prompt}
        activePath=""
        projectFiles={[]}
        processingLocation="local"
        hasReviewedContext={false}
        contextReviewed={false}
        requestActive={requestActive}
        manifestLoading={false}
        contextOpen={false}
        onPromptChange={onPromptChange}
        onOpenContext={vi.fn()}
        onSend={onSend}
        onStop={vi.fn()}
        onDropFiles={vi.fn()}
      />
    </I18nProvider>
  );
  return { input: screen.getByRole('textbox'), onSend, onPromptChange };
}

describe('chat input keyboard handling', () => {
  it('does not send an IME commit, Shift+Enter, or repeated send during a request', () => {
    const { input, onSend } = setup();
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, ctrlKey: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(2);
  });
  it('blocks a shortcut while a response is active', () => {
    const { input, onSend } = setup('hello', true);
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, ctrlKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });
  it('fills suggestions without sending or approving context', () => {
    const { onSend, onPromptChange } = setup('');
    fireEvent.click(screen.getByRole('button', { name: '解释这段内容' }));
    expect(onPromptChange).toHaveBeenCalledWith('解释这段内容');
    expect(onSend).not.toHaveBeenCalled();
  });
});
