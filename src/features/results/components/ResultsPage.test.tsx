import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { ResultSummary } from '../../../shared/types/domain';
import { resultInitialState, useResultStore } from '../resultStore';
import { ResultsPage } from './ResultsPage';

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
  beforeEach(() => {
    useResultStore.setState({
      ...resultInitialState,
      results: Array.from({ length: 85 }, (_, index) => resultAt(index + 1)),
      loadResults: vi.fn().mockResolvedValue(undefined),
      clearError: vi.fn(),
    });
  });

  it('renders a bounded first batch and exposes more results through a keyboard button', () => {
    render(
      <I18nProvider>
        <ResultsPage onOpenResult={vi.fn()} />
      </I18nProvider>
    );

    expect(screen.getAllByRole('article')).toHaveLength(40);
    expect(screen.getByText('已显示 40 / 共 85 项')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '显示更多成果' }));
    expect(screen.getAllByRole('article')).toHaveLength(80);
    expect(screen.getByText('已显示 80 / 共 85 项')).toBeVisible();
  });

  it('always shows the current total when the list does not need another batch', () => {
    useResultStore.setState({ results: [resultAt(1), resultAt(2), resultAt(3)] });

    render(
      <I18nProvider>
        <ResultsPage onOpenResult={vi.fn()} />
      </I18nProvider>
    );

    expect(screen.getByText('已显示 3 / 共 3 项')).toBeVisible();
    expect(screen.queryByRole('button', { name: '显示更多成果' })).not.toBeInTheDocument();
  });

  it('shows a zero total together with the empty state', () => {
    useResultStore.setState({ results: [] });

    render(
      <I18nProvider>
        <ResultsPage onOpenResult={vi.fn()} />
      </I18nProvider>
    );

    expect(screen.getByText('已显示 0 / 共 0 项')).toBeVisible();
  });
});
