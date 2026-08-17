import { create } from 'zustand';
import type { ImportBatch, ImportConfirmation, ImportDropOutcome } from '../../shared/types/domain';
import { errorDetails } from '../../stores/support';
import { importController } from './importController';

interface ImportState {
  batch: ImportBatch | null;
  acceptedItemIds: string[];
  loading: boolean;
  error: string | null;
  select: (workspaceId?: string) => Promise<void>;
  selectBrowserDropFallback: (workspaceId?: string) => Promise<void>;
  receiveDrop: (outcome: ImportDropOutcome) => void;
  reportError: (error: unknown) => void;
  toggle: (itemId: string) => void;
  confirm: () => Promise<ImportConfirmation | null>;
  cancel: () => Promise<void>;
  clearError: () => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  batch: null,
  acceptedItemIds: [],
  loading: false,
  error: null,

  select: async (workspaceId) => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const batch = await importController.select(workspaceId);
      if (!batch) return;
      set({
        batch,
        acceptedItemIds: batch.items
          .filter((item) => item.status === 'ready' && item.readable)
          .map((item) => item.id),
      });
    } catch (error) {
      set({ error: errorDetails(error).message });
    } finally {
      set({ loading: false });
    }
  },

  selectBrowserDropFallback: async (workspaceId) => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const batch = await importController.selectBrowserDropFallback(workspaceId);
      if (!batch) return;
      set({
        batch,
        acceptedItemIds: batch.items
          .filter((item) => item.status === 'ready' && item.readable)
          .map((item) => item.id),
      });
    } catch (error) {
      set({ error: errorDetails(error).message });
    } finally {
      set({ loading: false });
    }
  },

  receiveDrop: (outcome) => {
    if (outcome.errorMessage) {
      set({ error: outcome.errorMessage, loading: false });
      return;
    }
    if (!outcome.batch) return;
    set({
      batch: outcome.batch,
      acceptedItemIds: outcome.batch.items
        .filter((item) => item.status === 'ready' && item.readable)
        .map((item) => item.id),
      loading: false,
      error: null,
    });
  },

  reportError: (error) => set({ error: errorDetails(error).message, loading: false }),

  toggle: (itemId) =>
    set((state) => ({
      acceptedItemIds: state.acceptedItemIds.includes(itemId)
        ? state.acceptedItemIds.filter((id) => id !== itemId)
        : [...state.acceptedItemIds, itemId],
    })),

  confirm: async () => {
    const { batch, acceptedItemIds } = get();
    if (!batch || acceptedItemIds.length === 0) return null;
    set({ loading: true, error: null });
    try {
      const confirmation = await importController.confirm(batch.id, acceptedItemIds);
      set({ batch: null, acceptedItemIds: [] });
      return confirmation;
    } catch (error) {
      set({ error: errorDetails(error).message });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  cancel: async () => {
    const batch = get().batch;
    if (!batch) return;
    set({ loading: true, error: null });
    try {
      await importController.cancel(batch.id);
      set({ batch: null, acceptedItemIds: [] });
    } catch (error) {
      set({ error: errorDetails(error).message });
    } finally {
      set({ loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
