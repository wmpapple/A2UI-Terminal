import { createMockDiff } from '../../shared/mock/workspace';
import { errorDetails } from '../../stores/support';
import type { AppGet, AppSet, AppState } from '../../stores/types';
import { reviewController } from './reviewController';

type ReviewActions = Pick<
  AppState,
  'createProposal' | 'rejectDiff' | 'togglePatchChange' | 'applyDiff' | 'undoLastPatch'
>;

export const createReviewStore = (set: AppSet, get: AppGet): ReviewActions => ({
  createProposal: () => {
    const file = get().files.find((item) => item.path === get().activePath);
    if (file) set({ pendingDiff: createMockDiff(file), centerView: 'diff' });
  },
  rejectDiff: () => set({ pendingDiff: null, centerView: 'editor' }),
  togglePatchChange: (changeId) =>
    set((state) => ({
      pendingDiff: state.pendingDiff
        ? {
            ...state.pendingDiff,
            changes: state.pendingDiff.changes.map((change) =>
              change.id === changeId ? { ...change, selected: !change.selected } : change
            ),
          }
        : null,
    })),
  applyDiff: async () => {
    const proposal = get().pendingDiff;
    if (!proposal) return;
    const selected = proposal.changes.filter((change) => change.selected);
    if (selected.length === 0) {
      set({ patchError: '请至少选择一个修改块' });
      return;
    }
    const beforeByPath = Object.fromEntries(
      [...new Set(selected.map((change) => change.path))].map((path) => [
        path,
        get().files.find((file) => file.path === path)?.content ?? '',
      ])
    );
    if (get().runtimeMode === 'web-mock') {
      const files = selected.map((change) => ({
        path: change.path,
        content: change.after,
        contentHash: 'web-mock-after',
      }));
      set((state) => ({
        files: state.files.map((file) => {
          const applied = files.find((item) => item.path === file.path);
          return applied
            ? { ...file, content: applied.content, contentHash: applied.contentHash }
            : file;
        }),
        dirtyPaths: [...new Set([...state.dirtyPaths, ...files.map((file) => file.path)])],
        saveStatusByPath: Object.fromEntries([
          ...Object.entries(state.saveStatusByPath),
          ...files.map((file) => [file.path, 'dirty' as const]),
        ]),
        lastPatchApplication: {
          operationId: crypto.randomUUID(),
          summary: proposal.summary,
          undoOf: null,
          files,
        },
        patchBeforeByPath: beforeByPath,
        pendingDiff: null,
        centerView: 'editor',
        patchError: null,
      }));
      return;
    }
    const workspace = get().workspace;
    if (!workspace) return;
    set({ patchApplying: true, patchError: null });
    try {
      const application = await reviewController.apply({
        workspaceId: workspace.id,
        patch: proposal.patch,
        selectedChangeIds: selected.map((change) => change.id),
        sessionId: get().activeSessionId || undefined,
        assistantMessageId: get()
          .sessions.find((item) => item.id === get().activeSessionId)
          ?.messages.filter((message) => message.role === 'assistant')
          .at(-1)?.id,
      });
      set((state) => ({
        files: state.files.map((file) => {
          const applied = application.files.find((item) => item.path === file.path);
          return applied
            ? { ...file, content: applied.content, contentHash: applied.contentHash }
            : file;
        }),
        dirtyPaths: state.dirtyPaths.filter(
          (path) => !application.files.some((file) => file.path === path)
        ),
        saveStatusByPath: Object.fromEntries([
          ...Object.entries(state.saveStatusByPath),
          ...application.files.map((file) => [file.path, 'saved' as const]),
        ]),
        lastPatchApplication: application,
        patchBeforeByPath: beforeByPath,
        pendingDiff: null,
        centerView: 'editor',
      }));
    } catch (error) {
      set({ patchError: errorDetails(error).message });
    } finally {
      set({ patchApplying: false });
    }
  },
  undoLastPatch: async () => {
    const application = get().lastPatchApplication;
    if (!application) return;
    if (get().runtimeMode === 'web-mock') {
      set((state) => ({
        files: state.files.map((file) =>
          file.path in state.patchBeforeByPath
            ? { ...file, content: state.patchBeforeByPath[file.path] }
            : file
        ),
        lastPatchApplication: null,
        patchBeforeByPath: {},
        patchError: null,
      }));
      return;
    }
    const workspace = get().workspace;
    if (!workspace) return;
    set({ patchApplying: true, patchError: null });
    try {
      const undone = await reviewController.undo(workspace.id, application.operationId);
      set((state) => ({
        files: state.files.map((file) => {
          const restored = undone.files.find((item) => item.path === file.path);
          return restored
            ? { ...file, content: restored.content, contentHash: restored.contentHash }
            : file;
        }),
        dirtyPaths: state.dirtyPaths.filter(
          (path) => !undone.files.some((file) => file.path === path)
        ),
        saveStatusByPath: Object.fromEntries([
          ...Object.entries(state.saveStatusByPath),
          ...undone.files.map((file) => [file.path, 'saved' as const]),
        ]),
        lastPatchApplication: null,
        patchBeforeByPath: {},
      }));
    } catch (error) {
      set({ patchError: errorDetails(error).message });
    } finally {
      set({ patchApplying: false });
    }
  },
});
