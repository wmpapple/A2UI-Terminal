import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { ResultSummary } from '../../../shared/types/domain';
import { resultInitialState, useResultStore } from '../resultStore';
import { ResultsPage } from './ResultsPage';
import { resultController } from '../resultController';

const originalLoadResults = useResultStore.getState().loadResults;
const originalClearError = useResultStore.getState().clearError;

const resultAt = (index: number): ResultSummary => ({
  id: `result-${index}`,
  workspaceId: 'workspace-performance',
  type: 'document',
  title: `成果 ${index}`,
  status: 'ready',
  storageKind: 'managed_local',
  currentRevisionId: `revision-${index}`,
  a2uiSurfaceId: null,
  createdAt: '2026-09-18 08:00:00',
  updatedAt: '2026-09-18 08:00:00',
  completedAt: null,
});

describe('ResultsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useResultStore.setState({
      ...resultInitialState,
      loadResults: originalLoadResults,
      clearError: originalClearError,
    });
  });

  it('requires confirmation and removes the selected result from the list', async () => {
    const remove = vi.spyOn(resultController, 'delete').mockResolvedValue(undefined);
    render(
      <I18nProvider>
        <ResultsPage onOpenResult={vi.fn()} />
      </I18nProvider>
    );
    fireEvent.click(screen.getAllByRole('button', { name: /^删除成果:/ })[0]);
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('result-1'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '删除成果: 成果 1' })).not.toBeInTheDocument()
    );
    remove.mockRestore();
  });
  beforeEach(() => {
    useResultStore.setState({
      ...resultInitialState,
      results: Array.from({ length: 85 }, (_, index) => resultAt(index + 1)),
      loadResults: vi.fn().mockResolvedValue(undefined),
      clearError: vi.fn(),
    });
  });

  it('keeps pages bounded and reaches the last result and previous page', () => {
    render(
      <I18nProvider>
        <ResultsPage onOpenResult={vi.fn()} />
      </I18nProvider>
    );

    expect(screen.getAllByRole('article')).toHaveLength(40);
    expect(screen.getByText('第 1–40 项 / 共 85 项')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '下一页成果' }));
    expect(screen.getAllByRole('article')).toHaveLength(40);
    expect(screen.getByText('第 41–80 项 / 共 85 项')).toBeVisible();
    expect(screen.queryByText('成果 1', { exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一页成果' }));
    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(screen.getByText('成果 85')).toBeVisible();
    expect(screen.getByRole('button', { name: '下一页成果' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '上一页成果' }));
    expect(screen.getByText('成果 41')).toBeVisible();
  });

  it('pins a result from a later page and returns to the first page with that result first', async () => {
    const pin = vi.spyOn(resultController, 'pin').mockResolvedValue(undefined);
    const open = vi.fn();
    render(
      <I18nProvider>
        <ResultsPage onOpenResult={open} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: '下一页成果' }));
    fireEvent.click(screen.getByRole('button', { name: '下一页成果' }));
    fireEvent.click(screen.getByRole('button', { name: '置顶成果: 成果 85' }));

    await waitFor(() => expect(pin).toHaveBeenCalledWith('result-85', true));
    await waitFor(() => expect(screen.getByText('第 1–40 项 / 共 85 项')).toBeVisible());
    const first = screen.getAllByRole('article')[0];
    expect(within(first).getByText('成果 85', { exact: true })).toBeVisible();
    expect(within(first).getByRole('button', { name: '取消置顶: 成果 85' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getAllByRole('article')).toHaveLength(40);
    expect(open).not.toHaveBeenCalled();
  });

  it('disables pinning and deletion for a result until its pin request finishes', async () => {
    let complete!: () => void;
    const pin = vi.spyOn(resultController, 'pin').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    useResultStore.setState({ results: [resultAt(1), resultAt(2)] });
    render(
      <I18nProvider>
        <ResultsPage onOpenResult={vi.fn()} />
      </I18nProvider>
    );
    const button = screen.getByRole('button', { name: '置顶成果: 成果 1' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除成果: 成果 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '置顶成果: 成果 2' })).toBeEnabled();
    fireEvent.click(button);
    expect(pin).toHaveBeenCalledTimes(1);
    await act(async () => complete());
    expect(screen.getByRole('button', { name: '取消置顶: 成果 1' })).toBeEnabled();
  });

  it('retains the current page when pinning fails and displays the error', async () => {
    vi.spyOn(resultController, 'pin').mockRejectedValue(new Error('Pin unavailable'));
    render(
      <I18nProvider>
        <ResultsPage onOpenResult={vi.fn()} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: '下一页成果' }));
    fireEvent.click(screen.getByRole('button', { name: '置顶成果: 成果 41' }));
    await waitFor(() => expect(screen.getByText('Pin unavailable')).toBeVisible());
    expect(within(screen.getAllByRole('article')[0]).getByText('成果 41')).toBeVisible();
    expect(screen.getByRole('button', { name: '置顶成果: 成果 41' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('keeps the current page after unpinning a result', async () => {
    const pin = vi.spyOn(resultController, 'pin').mockResolvedValue(undefined);
    useResultStore.setState({
      results: Array.from({ length: 85 }, (_, index) => ({
        ...resultAt(index + 1),
        pinned: index < 41,
      })),
    });
    render(
      <I18nProvider>
        <ResultsPage onOpenResult={vi.fn()} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: '下一页成果' }));
    fireEvent.click(screen.getByRole('button', { name: '取消置顶: 成果 41' }));
    await waitFor(() => expect(pin).toHaveBeenCalledWith('result-41', false));
    await waitFor(() =>
      expect(
        useResultStore.getState().results.find((entry) => entry.id === 'result-41')?.pinned
      ).toBe(false)
    );
    expect(screen.getByText('第 41–80 项 / 共 85 项')).toBeVisible();
    expect(screen.getByRole('button', { name: '上一页成果' })).toBeEnabled();
  });

  it('always shows the current total when the list does not need another batch', () => {
    useResultStore.setState({ results: [resultAt(1), resultAt(2), resultAt(3)] });

    render(
      <I18nProvider>
        <ResultsPage onOpenResult={vi.fn()} />
      </I18nProvider>
    );

    expect(screen.getByText('第 1–3 项 / 共 3 项')).toBeVisible();
    expect(screen.queryByRole('button', { name: '下一页成果' })).not.toBeInTheDocument();
  });

  it('shows a zero total together with the empty state', () => {
    useResultStore.setState({ results: [] });

    render(
      <I18nProvider>
        <ResultsPage onOpenResult={vi.fn()} />
      </I18nProvider>
    );

    expect(screen.getByText('第 0–0 项 / 共 0 项')).toBeVisible();
  });
});
