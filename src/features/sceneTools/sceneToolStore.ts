import { create } from 'zustand';
import { sceneToolController } from './sceneToolController';
import type { SceneToolView } from '../../shared/types/sceneTool';

interface Entry {
  view: SceneToolView | null;
  data: Record<string, unknown>;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  conflict: boolean;
}
export const useSceneToolStore = create<{ entries: Record<string, Entry> }>(() => ({
  entries: {},
}));
const pending = new Map<string, Promise<boolean>>();
const loading = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const update = (id: string, value: Partial<Entry>) =>
  useSceneToolStore.setState((s) => ({
    entries: { ...s.entries, [id]: { ...s.entries[id], ...value } as Entry },
  }));
const entry = (id: string) => useSceneToolStore.getState().entries[id];
const errorMessage = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);

export const sceneTools = {
  async publish(id: string): Promise<boolean> {
    if (!(await sceneTools.save(id))) return false;
    const current = entry(id);
    if (!current.view) return false;
    try {
      const view = await sceneToolController.publish({
        resultId: id,
        baseHash: current.view.stateHash,
        expectedRevision: current.view.publication?.revisionId ?? null,
      });
      update(id, { view });
      window.dispatchEvent(new Event('scene-tool-list-changed'));
      return true;
    } catch (error: unknown) {
      const conflict = Boolean(
        error && typeof error === 'object' && 'code' in error && error.code === 'FILE_CONFLICT'
      );
      update(id, { error: errorMessage(error), conflict });
      return false;
    }
  },
  async load(id: string, discard = false): Promise<void> {
    if (!discard && entry(id)?.view) return;
    if (loading.has(id)) return loading.get(id);
    if (entry(id)?.saving) return;
    clearTimeout(timers.get(id));
    update(id, { view: null, data: {}, dirty: false, saving: false, error: null, conflict: false });
    const job = sceneToolController
      .read(id)
      .then((view) => {
        update(id, { view, data: view.surface.data });
      })
      .catch((error: unknown) => update(id, { error: errorMessage(error) }))
      .finally(() => loading.delete(id));
    loading.set(id, job);
    return job;
  },
  change(id: string, key: string, value: unknown) {
    const current = entry(id);
    if (!current?.view) return;
    update(id, { data: { ...current.data, [key]: value }, dirty: true });
    clearTimeout(timers.get(id));
    if (!current.conflict)
      timers.set(
        id,
        setTimeout(() => {
          void sceneTools.save(id);
        }, 600)
      );
  },
  async rename(id: string, title: string): Promise<boolean> {
    if (!(await sceneTools.save(id))) return false;
    try {
      const view = await sceneToolController.rename({ resultId: id, title });
      update(id, { view });
      return true;
    } catch (error: unknown) {
      update(id, { error: errorMessage(error) });
      return false;
    }
  },
  async reset(id: string): Promise<boolean> {
    if (!(await sceneTools.save(id))) return false;
    const current = entry(id);
    if (!current.view) return false;
    try {
      const view = await sceneToolController.reset({
        resultId: id,
        baseHash: current.view.stateHash,
      });
      update(id, { view, data: view.surface.data, dirty: false, error: null, conflict: false });
      window.dispatchEvent(new Event('scene-tool-list-changed'));
      return true;
    } catch (error: unknown) {
      const conflict = Boolean(
        error && typeof error === 'object' && 'code' in error && error.code === 'FILE_CONFLICT'
      );
      update(id, { error: errorMessage(error), conflict });
      return false;
    }
  },
  async delete(id: string): Promise<boolean> {
    try {
      clearTimeout(timers.get(id));
      await sceneToolController.delete(id);
      useSceneToolStore.setState((state) => {
        const entries = { ...state.entries };
        delete entries[id];
        return { entries };
      });
      return true;
    } catch (error: unknown) {
      update(id, { error: errorMessage(error) });
      return false;
    }
  },
  async save(id: string): Promise<boolean> {
    if (pending.has(id)) return pending.get(id)!;
    if (!entry(id)?.view || entry(id).conflict) return false;
    clearTimeout(timers.get(id));
    const job = (async () => {
      update(id, { saving: true, error: null });
      try {
        while (entry(id).dirty) {
          const current = entry(id);
          const sent = current.data;
          const view = await sceneToolController.save({
            resultId: id,
            baseHash: current.view!.stateHash,
            data: sent,
          });
          update(id, { view, dirty: entry(id).data !== sent });
          window.dispatchEvent(new Event('scene-tool-list-changed'));
        }
        return true;
      } catch (error: unknown) {
        const conflict = Boolean(
          error && typeof error === 'object' && 'code' in error && error.code === 'FILE_CONFLICT'
        );
        update(id, { error: errorMessage(error), conflict });
        return false;
      } finally {
        update(id, { saving: false });
        pending.delete(id);
      }
    })();
    pending.set(id, job);
    // A clean save may complete synchronously before the promise is registered.
    void job.then(() => {
      if (pending.get(id) === job) pending.delete(id);
    });
    return job;
  },
};
