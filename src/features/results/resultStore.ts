import { create } from 'zustand';
import type {
  CreateTextResultInput,
  FileSaveStatus,
  ResultDocument,
  ResultRevision,
  ResultRevisionSummary,
  ResultSummary,
} from '../../shared/types/domain';
import { errorDetails } from '../../stores/support';
import { resultController } from './resultController';

interface ResultState {
  results: ResultSummary[];
  activeDocument: ResultDocument | null;
  draftContent: string;
  saveStatus: FileSaveStatus;
  revisions: ResultRevisionSummary[];
  preview: ResultRevision | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  loadResults: () => Promise<void>;
  createTextResult: (input: CreateTextResultInput) => Promise<ResultDocument | null>;
  openResult: (resultId: string) => Promise<void>;
  updateDraft: (content: string) => void;
  save: () => Promise<void>;
  loadRevisions: () => Promise<void>;
  previewRevision: (revisionId: string) => Promise<void>;
  restoreRevision: (revisionId: string) => Promise<void>;
  undo: () => Promise<void>;
  duplicate: () => Promise<ResultDocument | null>;
  clearPreview: () => void;
  clearError: () => void;
}

export const resultInitialState = {
  results: [],
  activeDocument: null,
  draftContent: '',
  saveStatus: 'saved' as FileSaveStatus,
  revisions: [],
  preview: null,
  loading: false,
  saving: false,
  error: null,
};

const refreshList = async () => resultController.list();

export const useResultStore = create<ResultState>((set, get) => ({
  ...resultInitialState,

  loadResults: async () => {
    set({ loading: true, error: null });
    try {
      set({ results: await refreshList() });
    } catch (error) {
      set({ error: errorDetails(error).message });
    } finally {
      set({ loading: false });
    }
  },

  createTextResult: async (input) => {
    set({ loading: true, error: null });
    try {
      const activeDocument = await resultController.create(input);
      set({
        activeDocument,
        draftContent: activeDocument.content,
        saveStatus: 'saved',
        revisions: [],
        preview: null,
        results: await refreshList(),
      });
      return activeDocument;
    } catch (error) {
      set({ error: errorDetails(error).message });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  openResult: async (resultId) => {
    set({ loading: true, error: null, preview: null, revisions: [] });
    try {
      const activeDocument = await resultController.open(resultId);
      set({ activeDocument, draftContent: activeDocument.content, saveStatus: 'saved' });
    } catch (error) {
      set({ activeDocument: null, error: errorDetails(error).message });
    } finally {
      set({ loading: false });
    }
  },

  updateDraft: (draftContent) => {
    const current = get().activeDocument;
    if (!current || !current.editable) return;
    set({
      draftContent,
      saveStatus: draftContent === current.content ? 'saved' : 'dirty',
    });
  },

  save: async () => {
    const { activeDocument, draftContent, saving } = get();
    if (!activeDocument || saving || draftContent === activeDocument.content) return;
    set({ saving: true, saveStatus: 'saving', error: null });
    try {
      const saved = await resultController.save(
        activeDocument.result.id,
        draftContent,
        activeDocument.contentHash
      );
      set({
        activeDocument: saved,
        draftContent: saved.content,
        saveStatus: 'saved',
        results: await refreshList(),
      });
    } catch (error) {
      const detail = errorDetails(error);
      set({
        error: detail.message,
        saveStatus: detail.code === 'FILE_CONFLICT' ? 'conflict' : 'error',
      });
    } finally {
      set({ saving: false });
    }
  },

  loadRevisions: async () => {
    const resultId = get().activeDocument?.result.id;
    if (!resultId) return;
    set({ loading: true, error: null });
    try {
      set({ revisions: await resultController.listRevisions(resultId) });
    } catch (error) {
      set({ error: errorDetails(error).message });
    } finally {
      set({ loading: false });
    }
  },

  previewRevision: async (revisionId) => {
    const resultId = get().activeDocument?.result.id;
    if (!resultId) return;
    try {
      set({ preview: await resultController.readRevision(resultId, revisionId), error: null });
    } catch (error) {
      set({ error: errorDetails(error).message });
    }
  },

  restoreRevision: async (revisionId) => {
    const activeDocument = get().activeDocument;
    if (!activeDocument) return;
    set({ saving: true, saveStatus: 'saving', error: null });
    try {
      const restored = await resultController.restoreRevision(
        activeDocument.result.id,
        revisionId,
        activeDocument.contentHash
      );
      set({
        activeDocument: restored,
        draftContent: restored.content,
        saveStatus: 'saved',
        preview: null,
        revisions: await resultController.listRevisions(activeDocument.result.id),
      });
    } catch (error) {
      const detail = errorDetails(error);
      set({
        error: detail.message,
        saveStatus: detail.code === 'FILE_CONFLICT' ? 'conflict' : 'error',
      });
    } finally {
      set({ saving: false });
    }
  },

  undo: async () => {
    const { activeDocument, revisions } = get();
    if (!activeDocument || get().saveStatus === 'dirty') return;
    const history = revisions.length
      ? revisions
      : await resultController.listRevisions(activeDocument.result.id);
    const previous = history.find((revision) => !revision.isCurrent);
    if (previous) await get().restoreRevision(previous.id);
    else set({ revisions: history });
  },

  duplicate: async () => {
    const resultId = get().activeDocument?.result.id;
    if (!resultId) return null;
    set({ loading: true, error: null });
    try {
      const activeDocument = await resultController.duplicate(resultId);
      set({
        activeDocument,
        draftContent: activeDocument.content,
        saveStatus: 'saved',
        revisions: [],
        preview: null,
        results: await refreshList(),
      });
      return activeDocument;
    } catch (error) {
      set({ error: errorDetails(error).message });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  clearPreview: () => set({ preview: null }),
  clearError: () => set({ error: null }),
}));
