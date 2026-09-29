import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { SemanticSearch } from './SemanticSearch';
import type { SemanticStep } from '../../../shared/types/semanticSearch';

const api = vi.hoisted(() => ({
  listProviderConfigs: vi.fn(),
  getSemanticConfig: vi.fn(),
  planSemanticSearch: vi.fn(),
  stepSemanticSearch: vi.fn(),
  cancelSemanticSearch: vi.fn(),
  searchAuthorizedContent: vi.fn(),
}));
vi.mock('../semanticSearchController', () => ({ semanticSearchController: api }));
vi.mock('../../../shared/platform/runtime', () => ({ isWebMock: () => false }));
const config = {
  providerId: 'local',
  model: 'embeddings',
  revision: 'v1',
  dimensions: 384,
  location: 'local',
};
const plan = {
  id: 'plan',
  config,
  endpoint: 'http://127.0.0.1:11434/v1',
  query: '寻找资料',
  sources: [
    { key: 'knowledge:a', title: '资料 A', fragments: 1, missingFragments: 1, characters: 100 },
  ],
  totalChunks: 1,
  missingChunks: 1,
  characters: 104,
};
const result = {
  query: '寻找资料',
  items: [],
  indexedDocuments: 1,
  skippedDocuments: 0,
  indexMode: 'hybrid',
};
beforeEach(() => {
  vi.resetAllMocks();
  api.listProviderConfigs.mockResolvedValue([{ id: 'local', endpoint: plan.endpoint }]);
  api.getSemanticConfig.mockResolvedValue(config);
  api.planSemanticSearch.mockResolvedValue(plan);
  api.cancelSemanticSearch.mockResolvedValue(undefined);
});
async function prepare(onResult = vi.fn()) {
  const view = render(
    <I18nProvider>
      <SemanticSearch query="寻找资料" workspaceId={null} onResult={onResult} />
    </I18nProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: '语义搜索' }));
  await screen.findByRole('button', { name: '确认并搜索' });
  return { ...view, onResult };
}
describe('semantic search consent and lifecycle', () => {
  it('shows the query and source scope before sending and handles partial progress', async () => {
    api.stepSemanticSearch
      .mockResolvedValueOnce({ done: false, completed: 1, total: 1, result: null })
      .mockResolvedValueOnce({ done: true, completed: 1, total: 1, result, fallbackReason: null });
    const { onResult } = await prepare();
    expect(api.stepSemanticSearch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('寻找资料')).toBeVisible());
    expect(screen.getByText(/资料 A/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认并搜索' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(result));
    expect(api.stepSemanticSearch).toHaveBeenCalledTimes(2);
    expect(api.stepSemanticSearch).toHaveBeenCalledWith('plan', true);
  });
  it('cancels on exit and ignores a late model response', async () => {
    let finish!: (value: SemanticStep) => void;
    api.stepSemanticSearch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { onResult, unmount } = await prepare();
    fireEvent.click(screen.getByRole('button', { name: '确认并搜索' }));
    await waitFor(() => expect(api.stepSemanticSearch).toHaveBeenCalled());
    unmount();
    expect(api.cancelSemanticSearch).toHaveBeenCalledWith('plan');
    await act(async () =>
      finish({
        done: true,
        completed: 1,
        total: 1,
        result: { ...result, indexMode: 'hybrid' },
        fallbackReason: null,
      })
    );
    expect(onResult).not.toHaveBeenCalled();
  });
  it('shows the provider failure reason and returns keyword results', async () => {
    const fallback = { ...result, indexMode: 'persistent_lexical' };
    api.stepSemanticSearch.mockResolvedValue({
      done: true,
      completed: 0,
      total: 1,
      result: fallback,
      fallbackReason: '向量维度不符；已返回关键词搜索结果。',
    });
    const { onResult } = await prepare();
    fireEvent.click(screen.getByRole('button', { name: '确认并搜索' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(fallback));
    expect(await screen.findByText('向量维度不符；已返回关键词搜索结果。')).toBeVisible();
  });
});
