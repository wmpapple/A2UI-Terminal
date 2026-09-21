import { beforeEach, expect, it, vi } from 'vitest';
import { resultController } from './resultController';
import { resultInitialState, useResultStore } from './resultStore';

beforeEach(() => {
  vi.restoreAllMocks();
  useResultStore.setState(resultInitialState);
});
it('removes a result only after persistence succeeds and reports failures', async () => {
  const results = await resultController.list();
  useResultStore.setState({ results });
  const remove = vi.spyOn(resultController, 'delete').mockRejectedValue(new Error('failed'));
  expect(await useResultStore.getState().deleteResult(results[0].id)).toBe(false);
  expect(useResultStore.getState().results).toHaveLength(results.length);
  expect(useResultStore.getState().error).toBeTruthy();
  remove.mockResolvedValue(undefined);
  expect(await useResultStore.getState().deleteResult(results[0].id)).toBe(true);
  expect(useResultStore.getState().results.some((result) => result.id === results[0].id)).toBe(
    false
  );
});
