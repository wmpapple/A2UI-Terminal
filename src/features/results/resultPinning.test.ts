import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultDocument, ResultSummary } from '../../shared/types/domain';
import { resultController } from './resultController';
import { resultInitialState, useResultStore } from './resultStore';

const result = (id: string, updatedAt: string, pinned?: boolean): ResultSummary => ({
  id,
  workspaceId: 'workspace-pinning',
  type: 'document',
  title: id,
  status: 'ready',
  storageKind: 'managed_local',
  currentRevisionId: `revision-${id}`,
  a2uiSurfaceId: null,
  createdAt: '2026-09-01 08:00:00',
  updatedAt,
  completedAt: null,
  ...(pinned === undefined ? {} : { pinned }),
});

const documentFor = (summary: ResultSummary): ResultDocument => ({
  result: {
    ...summary,
    storageRef: 'managed/document.md',
    activeSessionId: null,
    managedState: null,
  },
  format: 'markdown',
  content: 'Saved content',
  contentHash: 'saved-hash',
  sizeBytes: 13,
  editable: true,
  appliedReview: null,
  recoveryDraft: null,
});

beforeEach(() => {
  useResultStore.setState(resultInitialState);
});

afterEach(() => {
  vi.restoreAllMocks();
  useResultStore.setState(resultInitialState);
});

describe('result pinning', () => {
  it('waits for persistence, prevents duplicate requests, and preserves the active draft', async () => {
    const older = result('older', '2026-09-18 08:00:00');
    const newer = result('newer', '2026-09-20 08:00:00');
    const activeDocument = documentFor(older);
    const results = [newer, older];
    useResultStore.setState({
      results,
      activeDocument,
      draftContent: 'Unsaved edits',
      saveStatus: 'dirty',
    });
    let complete!: () => void;
    const pin = vi.spyOn(resultController, 'pin').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );

    const pending = useResultStore.getState().pinResult('older', true);
    expect(pin).toHaveBeenCalledWith('older', true);
    expect(useResultStore.getState().results).toBe(results);
    expect(useResultStore.getState().activeDocument).toBe(activeDocument);
    expect(useResultStore.getState().pinningResultIds).toEqual(['older']);
    expect(await useResultStore.getState().pinResult('older', true)).toBe(false);
    expect(pin).toHaveBeenCalledTimes(1);

    complete();
    expect(await pending).toBe(true);
    const state = useResultStore.getState();
    expect(state.results.map((entry) => entry.id)).toEqual(['older', 'newer']);
    expect(state.activeDocument).toEqual({
      ...activeDocument,
      result: { ...activeDocument.result, pinned: true },
    });
    expect(state.results[0].updatedAt).toBe(older.updatedAt);
    expect(state.draftContent).toBe('Unsaved edits');
    expect(state.saveStatus).toBe('dirty');
    expect(state.pinningResultIds).toEqual([]);
  });

  it('retains exact list order and document metadata when persistence fails', async () => {
    const results = [
      result('recent', '2026-09-20 08:00:00'),
      result('older', '2026-09-18 08:00:00'),
    ];
    const activeDocument = documentFor(results[1]);
    useResultStore.setState({ results, activeDocument });
    vi.spyOn(resultController, 'pin').mockRejectedValue(new Error('Pin could not be saved'));

    expect(await useResultStore.getState().pinResult('older', true)).toBe(false);
    expect(useResultStore.getState().results).toBe(results);
    expect(useResultStore.getState().activeDocument).toBe(activeDocument);
    expect(useResultStore.getState().error).toBe('Pin could not be saved');
    expect(useResultStore.getState().pinningResultIds).toEqual([]);
  });

  it('loads pinned items first and restores chronological order when unpinned', async () => {
    const oldest = result('oldest', '2026-09-01 08:00:00', true);
    const recent = result('recent', '2026-09-20 08:00:00');
    const pinnedA = result('pinned-a', '2026-09-18 08:00:00', true);
    const pinnedZ = result('pinned-z', '2026-09-18 08:00:00', true);
    vi.spyOn(resultController, 'list').mockResolvedValue([recent, oldest, pinnedA, pinnedZ]);
    const pin = vi.spyOn(resultController, 'pin').mockResolvedValue(undefined);

    await useResultStore.getState().loadResults();
    expect(useResultStore.getState().results.map((entry) => entry.id)).toEqual([
      'pinned-z',
      'pinned-a',
      'oldest',
      'recent',
    ]);
    expect(await useResultStore.getState().pinResult('oldest', false)).toBe(true);
    expect(pin).toHaveBeenCalledWith('oldest', false);
    expect(useResultStore.getState().results.map((entry) => entry.id)).toEqual([
      'pinned-z',
      'pinned-a',
      'recent',
      'oldest',
    ]);
    expect(useResultStore.getState().results.at(-1)?.pinned).toBe(false);
    expect(useResultStore.getState().results.at(-1)?.updatedAt).toBe(oldest.updatedAt);
  });
});
