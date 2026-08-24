import { createMockDiff } from '../../shared/mock/workspace';
import {
  createWebMockReviewResult,
  deleteWebMockReviewResult,
  deleteWebMockReviewResultByReview,
} from '../../shared/mock/home';
import { errorDetails } from '../../stores/support';
import type { AppGet, AppSet, AppState } from '../../stores/types';
import { reviewController } from './reviewController';

type ReviewActions = Pick<
  AppState,
  | 'createProposal'
  | 'rejectDiff'
  | 'togglePatchChange'
  | 'setReviewFileName'
  | 'applyDiff'
  | 'resolveReviewConflict'
  | 'undoLastPatch'
>;

export const createReviewStore = (set: AppSet, get: AppGet): ReviewActions => ({
  createProposal: () => {
    const file = get().files.find((item) => item.path === get().activePath);
    if (file) set({ pendingDiff: createMockDiff(file), centerView: 'diff' });
  },
  rejectDiff: async () => {
    const proposal = get().pendingDiff;
    const workspace = get().workspace;
    if (proposal && workspace && get().runtimeMode === 'desktop') {
      try {
        await reviewController.discard(workspace.id, proposal.id);
        const remaining = await reviewController.listActive(workspace.id);
        set({
          pendingDiff: remaining[0] ?? null,
          centerView: remaining.length > 0 ? 'diff' : 'editor',
          patchError: null,
        });
        return;
      } catch (error) {
        set({ patchError: errorDetails(error).message });
        return;
      }
    }
    set({ pendingDiff: null, centerView: 'editor', patchError: null });
  },
  togglePatchChange: (changeId) =>
    set((state) => ({
      pendingDiff: state.pendingDiff
        ? {
            ...state.pendingDiff,
            blocks: state.pendingDiff.blocks.map((block) =>
              block.id === changeId ? { ...block, selected: !(block.selected ?? true) } : block
            ),
          }
        : null,
    })),
  setReviewFileName: (blockId, fileName) =>
    set((state) => ({
      pendingDiff: state.pendingDiff
        ? {
            ...state.pendingDiff,
            blocks: state.pendingDiff.blocks.map((block) =>
              block.id === blockId ? { ...block, decidedFileName: fileName } : block
            ),
          }
        : null,
    })),
  applyDiff: async () => {
    const proposal = get().pendingDiff;
    if (!proposal) return;
    const selected = proposal.blocks.filter((block) => block.selected ?? true);
    if (selected.length === 0) {
      set({ patchError: '请至少选择一个修改块' });
      return;
    }
    const beforeByPath = Object.fromEntries(
      [...new Set(selected.map((block) => block.targetLabel))].map((path) => [
        path,
        get().files.find((file) => file.path === path)?.content ?? '',
      ])
    );
    if (get().runtimeMode === 'web-mock') {
      const createBlock = selected.find((block) => block.kind === 'create_file');
      const createdFileName =
        createBlock?.decidedFileName ?? createBlock?.suggestedFileName ?? 'AI-成果.md';
      const createdResult = createBlock
        ? await createWebMockReviewResult({
            title: createdFileName.replace(/\.(?:md|markdown|txt)$/i, ''),
            fileName: createdFileName,
            format: createdFileName.toLowerCase().endsWith('.txt') ? 'plain_text' : 'markdown',
            content: createBlock.after,
            reviewId: proposal.id,
            workspaceId: proposal.workspaceId,
          })
        : null;
      const files = selected
        .filter((block) => block.kind !== 'create_file')
        .map((block) => ({
          path: block.targetLabel,
          content: block.after,
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
        lastReviewApplication: {
          reviewId: proposal.id,
          status: 'applied',
          operationId: crypto.randomUUID(),
          files,
          result: createdResult,
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
      await reviewController.decide(
        proposal.id,
        workspace.id,
        proposal.blocks.map((block) => ({
          blockId: block.id,
          accepted: block.selected ?? true,
          fileName:
            block.kind === 'create_file'
              ? (block.decidedFileName ?? block.suggestedFileName)
              : undefined,
        }))
      );
      const application = await reviewController.apply(proposal.id, workspace.id);
      const remaining = await reviewController.listActive(workspace.id);
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
        lastPatchApplication: application.operationId
          ? {
              operationId: application.operationId,
              summary: proposal.summary,
              undoOf: null,
              files: application.files,
            }
          : null,
        lastReviewApplication: application,
        patchBeforeByPath: beforeByPath,
        pendingDiff: remaining[0] ?? null,
        centerView: remaining.length > 0 ? 'diff' : 'editor',
      }));
    } catch (error) {
      const details = errorDetails(error);
      if (details.code === 'FILE_CONFLICT') {
        try {
          const persisted = await reviewController.get(proposal.id);
          set({ pendingDiff: persisted, patchError: details.message });
        } catch {
          set({
            pendingDiff: { ...proposal, status: 'conflicted', errorCode: 'FILE_CONFLICT' },
            patchError: details.message,
          });
        }
      } else {
        set({ patchError: details.message });
      }
    } finally {
      set({ patchApplying: false });
    }
  },
  resolveReviewConflict: async (resolution) => {
    const proposal = get().pendingDiff;
    const workspace = get().workspace;
    if (!proposal || proposal.status !== 'conflicted') return;
    if (get().runtimeMode === 'web-mock' || !workspace) {
      set({ pendingDiff: null, centerView: 'editor', patchError: null });
      return;
    }
    set({ patchApplying: true, patchError: null });
    try {
      const application = await reviewController.resolveConflict(
        proposal.id,
        workspace.id,
        resolution
      );
      const remaining = await reviewController.listActive(workspace.id);
      set({
        pendingDiff: remaining[0] ?? null,
        centerView: remaining.length > 0 ? 'diff' : 'editor',
        patchError: null,
        lastReviewApplication: application.status === 'applied' ? application : null,
        chatError:
          resolution === 'regenerate' ? '请基于当前最新文件重新发送生成请求。' : get().chatError,
      });
    } catch (error) {
      set({ patchError: errorDetails(error).message });
    } finally {
      set({ patchApplying: false });
    }
  },
  undoLastPatch: async (persistedReview) => {
    const reviewApplication = get().lastReviewApplication;
    const application = get().lastPatchApplication;
    const currentWorkspaceId = get().workspace?.id;
    const review =
      persistedReview ??
      (reviewApplication && currentWorkspaceId
        ? { reviewId: reviewApplication.reviewId, workspaceId: currentWorkspaceId }
        : null);
    if (!review && !application && !reviewApplication) {
      set({ patchError: '没有可撤销的 AI 修改' });
      return false;
    }
    if (get().runtimeMode === 'web-mock') {
      if (reviewApplication?.result) {
        deleteWebMockReviewResult(reviewApplication.result.result.id);
      } else if (review) {
        deleteWebMockReviewResultByReview(review.reviewId, review.workspaceId);
      }
      set((state) => ({
        files: state.files
          .filter((file) => state.patchBeforeByPath[file.path] !== '__A2UI_FILE_ABSENT__')
          .map((file) =>
            file.path in state.patchBeforeByPath
              ? { ...file, content: state.patchBeforeByPath[file.path] }
              : file
          ),
        workspaceEntries: state.workspaceEntries.filter(
          (entry) => state.patchBeforeByPath[entry.path] !== '__A2UI_FILE_ABSENT__'
        ),
        lastPatchApplication: null,
        lastReviewApplication: null,
        patchBeforeByPath: {},
        patchError: null,
      }));
      return true;
    }
    const workspaceId = review?.workspaceId ?? currentWorkspaceId;
    if (!workspaceId) {
      set({ patchError: '当前工作区不可用，无法撤销上次 AI 修改' });
      return false;
    }
    set({ patchApplying: true, patchError: null });
    try {
      const undone = review
        ? await reviewController.undoReview(review.reviewId, workspaceId)
        : await reviewController.undo(workspaceId, application!.operationId);
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
        lastReviewApplication: null,
        patchBeforeByPath: {},
      }));
      return true;
    } catch (error) {
      set({ patchError: errorDetails(error).message });
      return false;
    } finally {
      set({ patchApplying: false });
    }
  },
});
