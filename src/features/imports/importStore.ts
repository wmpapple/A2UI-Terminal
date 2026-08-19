import { create } from 'zustand';
import type {
  DocumentSource,
  DocumentSourceContent,
  ImportBatch,
  ImportConfirmation,
  ImportDropOutcome,
} from '../../shared/types/domain';
import { errorDetails } from '../../stores/support';
import { importController } from './importController';

const mergeWorkspaceSources = (
  existing: DocumentSource[],
  incoming: DocumentSource[],
  workspaceId: string
): DocumentSource[] => {
  const merged = new Map<string, DocumentSource>();
  for (const source of existing) {
    if (source.workspaceId === workspaceId) merged.set(source.id, source);
  }
  for (const source of incoming) {
    if (source.workspaceId === workspaceId) merged.set(source.id, source);
  }
  return [...merged.values()];
};

interface ImportState {
  batch: ImportBatch | null;
  acceptedItemIds: string[];
  loading: boolean;
  error: string | null;
  sources: DocumentSource[];
  sourceContent: DocumentSourceContent | null;
  sourceLoading: boolean;
  revokingSourceId: string | null;
  select: (workspaceId?: string) => Promise<void>;
  selectBrowserDropFallback: (workspaceId?: string) => Promise<void>;
  receiveDrop: (outcome: ImportDropOutcome) => void;
  reportError: (error: unknown) => void;
  toggle: (itemId: string) => void;
  confirm: () => Promise<ImportConfirmation | null>;
  cancel: () => Promise<void>;
  clearError: () => void;
  loadSources: (workspaceId: string) => Promise<void>;
  previewSource: (sourceId: string) => Promise<void>;
  revokeSource: (workspaceId: string, sourceId: string) => Promise<boolean>;
  closeSourcePreview: () => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  batch: null,
  acceptedItemIds: [],
  loading: false,
  error: null,
  sources: [],
  sourceContent: null,
  sourceLoading: false,
  revokingSourceId: null,

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
      const workspaceId = confirmation.workspace?.id;
      set((state) => ({
        batch: null,
        acceptedItemIds: [],
        sources: workspaceId
          ? mergeWorkspaceSources(state.sources, confirmation.sources, workspaceId)
          : state.sources,
      }));
      if (workspaceId) {
        try {
          const sources = await importController.listSources(workspaceId);
          set({ sources });
        } catch (error) {
          set({ error: `资料已加入，但完整列表刷新失败：${errorDetails(error).message}` });
        }
      }
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

  loadSources: async (workspaceId) => {
    try {
      const sources = await importController.listSources(workspaceId);
      set({ sources });
    } catch (error) {
      set({ error: errorDetails(error).message });
    }
  },

  previewSource: async (sourceId) => {
    set({ sourceLoading: true, error: null });
    try {
      const sourceContent = await importController.readSource(sourceId);
      set((state) =>
        state.sources.some((source) => source.id === sourceId) ? { sourceContent } : state
      );
    } catch (error) {
      set({ error: errorDetails(error).message });
    } finally {
      set({ sourceLoading: false });
    }
  },

  revokeSource: async (workspaceId, sourceId) => {
    if (get().revokingSourceId) return false;
    set({ revokingSourceId: sourceId, error: null });
    try {
      await importController.revokeSource(workspaceId, sourceId);
      set((state) => ({
        sources: state.sources.filter(
          (source) => source.workspaceId !== workspaceId || source.id !== sourceId
        ),
        sourceContent: state.sourceContent?.source.id === sourceId ? null : state.sourceContent,
      }));
      try {
        const sources = await importController.listSources(workspaceId);
        set({ sources });
      } catch (error) {
        set({ error: `授权已取消，但完整列表刷新失败：${errorDetails(error).message}` });
      }
      return true;
    } catch (error) {
      set({ error: errorDetails(error).message });
      return false;
    } finally {
      set({ revokingSourceId: null });
    }
  },

  closeSourcePreview: () => set({ sourceContent: null }),
}));
