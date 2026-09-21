import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { SearchAuthorizedContentOutput } from '../../../shared/types/domain';
import { AuthorizedSearch } from './AuthorizedSearch';

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../homeController', () => ({ homeController: { search } }));
const output = (title: string): SearchAuthorizedContentOutput => ({
  query: title,
  items: [{ id: title, kind: 'result', title, snippet: '', updatedAt: null, score: 1 }],
  indexedDocuments: 1,
  skippedDocuments: 0,
  indexMode: 'memory_lexical',
});
const setup = () => {
  render(
    <I18nProvider>
      <AuthorizedSearch onOpenWorkbench={vi.fn()} />
    </I18nProvider>
  );
  return screen.getByRole('textbox');
};
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(260);
  });
beforeEach(() => {
  vi.useFakeTimers();
  search.mockReset().mockResolvedValue(output('Found'));
});
afterEach(() => vi.useRealTimers());

describe('live authorized search', () => {
  it('debounces typing and waits for composition to finish', async () => {
    const input = setup();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '资料' } });
    await tick();
    expect(search).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: '资料总结' } });
    await tick();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][1]).toBe('资料总结');
    expect(screen.getByText('Found')).toBeVisible();
  });

  it('ignores responses for changed or cleared input', async () => {
    let finishOld!: (value: SearchAuthorizedContentOutput) => void;
    search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    );
    const input = setup();
    fireEvent.change(input, { target: { value: 'old' } });
    await tick();
    fireEvent.change(input, { target: { value: 'new' } });
    await tick();
    await act(async () => finishOld(output('Old result')));
    expect(screen.queryByText('Old result')).not.toBeInTheDocument();
    expect(screen.getByText('Found')).toBeVisible();
    let finishCleared!: (value: SearchAuthorizedContentOutput) => void;
    search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCleared = resolve;
        })
    );
    fireEvent.change(input, { target: { value: 'pending' } });
    await tick();
    fireEvent.change(input, { target: { value: '' } });
    await act(async () => finishCleared(output('Cleared result')));
    expect(screen.queryByText('Cleared result')).not.toBeInTheDocument();
  });
});
