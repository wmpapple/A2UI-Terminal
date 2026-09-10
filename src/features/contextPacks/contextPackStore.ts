import { create } from 'zustand';
import type { ContextPack } from '../../shared/types/domain';
import { errorDetails } from '../../stores/support';
import { contextPackController } from './contextPackController';

interface ContextPackState {
  packs: ContextPack[];
  loading: boolean;
  error: string | null;
  load: (workspaceId: string) => Promise<void>;
  createPack: (workspaceId: string, name: string, sourceIds: string[]) => Promise<boolean>;
  deletePack: (workspaceId: string, packId: string) => Promise<boolean>;
  forgetSource: (workspaceId: string, sourceId: string) => void;
  clearError: () => void;
}

export const useContextPackStore = create<ContextPackState>((set, get) => ({
  packs: [],
  loading: false,
  error: null,

  load: async (workspaceId) => {
    set({ loading: true, error: null });
    try {
      const packs = await contextPackController.list(workspaceId);
      set({ packs });
    } catch (error) {
      set({ error: errorDetails(error).message });
    } finally {
      set({ loading: false });
    }
  },

  createPack: async (workspaceId, name, sourceIds) => {
    if (get().loading) return false;
    set({ loading: true, error: null });
    try {
      const pack = await contextPackController.create({ workspaceId, name, sourceIds });
      set((state) => ({
        packs: [pack, ...state.packs.filter((item) => item.id !== pack.id)],
      }));
      return true;
    } catch (error) {
      set({ error: errorDetails(error).message });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  deletePack: async (workspaceId, packId) => {
    if (get().loading) return false;
    set({ loading: true, error: null });
    try {
      await contextPackController.delete(workspaceId, packId);
      set((state) => ({ packs: state.packs.filter((pack) => pack.id !== packId) }));
      return true;
    } catch (error) {
      set({ error: errorDetails(error).message });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  forgetSource: (workspaceId, sourceId) =>
    set((state) => ({
      packs: state.packs
        .filter(
          (pack) =>
            pack.workspaceId !== workspaceId ||
            pack.items.length > 1 ||
            pack.items[0]?.sourceId !== sourceId
        )
        .map((pack) =>
          pack.workspaceId === workspaceId
            ? { ...pack, items: pack.items.filter((item) => item.sourceId !== sourceId) }
            : pack
        ),
    })),

  clearError: () => set({ error: null }),
}));
