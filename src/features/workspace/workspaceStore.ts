import type {
  A2uiInspection,
  A2uiSurface,
  SelectedWorkspaceFiles,
  WorkspaceFile,
  WorkspaceFileEntry,
} from '../../shared/types/domain';
import { errorDetails } from '../../stores/support';
import type { AppGet, AppSet, AppState } from '../../stores/types';
import { a2uiController } from '../a2ui/a2uiController';
import { chatController } from '../chat/chatController';
import { workspaceController } from './workspaceController';

type WorkspaceActions = Pick<
  AppState,
  | 'initializeWorkspace'
  | 'selectWorkspace'
  | 'selectContextFiles'
  | 'acceptImportedSelection'
  | 'restoreWorkspace'
  | 'removeCurrentWorkspace'
  | 'forgetAuthorizedSource'
  | 'openFile'
  | 'closeFile'
  | 'updateFile'
  | 'persistDraft'
  | 'saveFileToDisk'
  | 'restoreRecoveryDraft'
  | 'discardRecoveryDraft'
  | 'loadDocumentVersions'
  | 'previewDocumentVersion'
  | 'restoreDocumentVersion'
  | 'clearVersionPreview'
  | 'markSaved'
  | 'clearWorkspaceError'
  | 'setCenterView'
>;

const loadA2uiHistory = async (
  workspaceId: string
): Promise<{
  surfaces: A2uiSurface[];
  inspections: A2uiInspection[];
}> => {
  try {
    return await a2uiController.listHistory(workspaceId);
  } catch {
    return { surfaces: [], inspections: [] };
  }
};

export const createWorkspaceStore = (set: AppSet, get: AppGet): WorkspaceActions => ({
  initializeWorkspace: async () => {
    if (get().runtimeMode === 'web-mock') return;
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const recentWorkspaces = await workspaceController.listRecent();
      set({ recentWorkspaces });
      const firstAvailable = recentWorkspaces.find((item) => item.available);
      if (firstAvailable) await get().restoreWorkspace(firstAvailable.id);
    } catch (error) {
      set({ workspaceError: errorDetails(error).message });
    } finally {
      set({ workspaceLoading: false });
    }
  },

  selectWorkspace: async () => {
    if (get().runtimeMode === 'web-mock') return;
    await Promise.all(get().dirtyPaths.map((path) => get().persistDraft(path)));
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const workspace = await workspaceController.select();
      if (!workspace) return;
      const [workspaceEntries, a2uiHistory, recoveryDraftSummaries] = await Promise.all([
        workspaceController.listFiles(workspace.id),
        loadA2uiHistory(workspace.id),
        workspaceController.listRecoveryDrafts(workspace.id),
      ]);
      const { surfaces: a2uiSurfaces, inspections: a2uiInspections } = a2uiHistory;
      const recentWorkspaces = await workspaceController.listRecent();
      let sessions = await chatController.listSessions(workspace.id);
      if (sessions.length === 0) {
        sessions = [
          await chatController.createSession(workspace.id, crypto.randomUUID(), '新对话'),
        ];
      }
      set({
        workspace,
        recentWorkspaces,
        workspaceEntries,
        files: [],
        openPaths: [],
        activePath: '',
        dirtyPaths: [],
        saveStatusByPath: Object.fromEntries(
          recoveryDraftSummaries.map((draft) => [
            draft.relativePath,
            draft.conflict ? 'conflict' : 'draft',
          ])
        ),
        recoveryDrafts: {},
        recoveryDraftSummaries,
        documentVersions: [],
        versionPreview: null,
        versionHistoryPath: '',
        versionHistoryLoading: false,
        versionHistoryError: null,
        sessions,
        activeSessionId: sessions[0].id,
        contextBySession: {},
        contextReviewKeyBySession: {},
        chatError: null,
        a2uiSurfaces,
        a2uiInspections,
        activeSurfaceId: a2uiSurfaces[0]?.surfaceId ?? '',
        activeInspectionId: a2uiInspections[0]?.id ?? '',
        a2uiNotice: null,
        centerView: 'editor',
      });
    } catch (error) {
      set({ workspaceError: errorDetails(error).message });
    } finally {
      set({ workspaceLoading: false });
    }
  },

  selectContextFiles: async () => {
    if (get().runtimeMode === 'web-mock') return;
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const currentWorkspace = get().workspace;
      const result = await workspaceController.selectContextFiles(currentWorkspace?.id);
      if (!result || result.documents.length === 0) return;
      const { workspace, documents } = result;
      const recentWorkspaces = await workspaceController.listRecent();
      const recoveryDraftSummaries = await workspaceController.listRecoveryDrafts(workspace.id);
      let sessions = get().sessions;
      let activeSessionId = get().activeSessionId;
      let a2uiSurfaces = get().a2uiSurfaces;
      let a2uiInspections = get().a2uiInspections;
      if (!currentWorkspace || currentWorkspace.id !== workspace.id) {
        sessions = await chatController.listSessions(workspace.id);
        if (sessions.length === 0) {
          sessions = [
            await chatController.createSession(workspace.id, crypto.randomUUID(), '新对话'),
          ];
        }
        activeSessionId = sessions[0].id;
        const history = await loadA2uiHistory(workspace.id);
        a2uiSurfaces = history.surfaces;
        a2uiInspections = history.inspections;
      }
      const selectedFiles: WorkspaceFile[] = documents.map((document) => ({
        path: document.path,
        name: document.name,
        language: document.language,
        content: document.content,
        contentHash: document.contentHash,
        sizeBytes: document.sizeBytes,
        editable: document.editable,
        extracted: document.extracted,
        sourceId: document.sourceId,
      }));
      const selectedRecoveryDrafts = Object.fromEntries(
        documents
          .filter((document) => document.draft)
          .map((document) => [document.path, document.draft!])
      );
      set((state) => {
        const selectedPaths = selectedFiles.map((file) => file.path);
        const selectedEntries: WorkspaceFileEntry[] = selectedFiles.map((file) => ({
          path: file.path,
          name: file.name,
          language: file.language,
          sizeBytes: file.sizeBytes ?? 0,
          readable: true,
          editable: file.editable !== false,
          extracted: file.extracted === true,
          sourceId: file.sourceId,
        }));
        return {
          workspace,
          recentWorkspaces,
          sessions,
          activeSessionId,
          a2uiSurfaces,
          a2uiInspections,
          activeSurfaceId: a2uiSurfaces[0]?.surfaceId ?? '',
          activeInspectionId: a2uiInspections[0]?.id ?? '',
          centerView: 'editor',
          files: [
            ...state.files.filter((file) => !selectedPaths.includes(file.path)),
            ...selectedFiles,
          ],
          openPaths: [
            ...state.openPaths.filter((path) => !selectedPaths.includes(path)),
            ...selectedPaths,
          ],
          activePath: selectedPaths[0] ?? state.activePath,
          workspaceEntries: [
            ...state.workspaceEntries.filter((entry) => !selectedPaths.includes(entry.path)),
            ...selectedEntries,
          ],
          saveStatusByPath: {
            ...state.saveStatusByPath,
            ...Object.fromEntries(selectedPaths.map((path) => [path, 'saved' as const])),
            ...Object.fromEntries(
              recoveryDraftSummaries.map((draft) => [
                draft.relativePath,
                draft.conflict ? ('conflict' as const) : ('draft' as const),
              ])
            ),
          },
          recoveryDraftSummaries,
          recoveryDrafts:
            currentWorkspace?.id === workspace.id
              ? { ...state.recoveryDrafts, ...selectedRecoveryDrafts }
              : selectedRecoveryDrafts,
        };
      });
    } catch (error) {
      set({ workspaceError: errorDetails(error).message });
    } finally {
      set({ workspaceLoading: false });
    }
  },

  acceptImportedSelection: async ({ workspace, documents }: SelectedWorkspaceFiles) => {
    const currentWorkspace = get().workspace;
    const isWebMock = get().runtimeMode === 'web-mock';
    const recentWorkspaces = isWebMock ? [workspace] : await workspaceController.listRecent();
    const recoveryDraftSummaries = isWebMock
      ? []
      : await workspaceController.listRecoveryDrafts(workspace.id);
    let sessions = get().sessions;
    let activeSessionId = get().activeSessionId;
    let a2uiSurfaces = get().a2uiSurfaces;
    let a2uiInspections = get().a2uiInspections;
    if (!isWebMock && (!currentWorkspace || currentWorkspace.id !== workspace.id)) {
      sessions = await chatController.listSessions(workspace.id);
      if (sessions.length === 0) {
        sessions = [
          await chatController.createSession(workspace.id, crypto.randomUUID(), '新对话'),
        ];
      }
      activeSessionId = sessions[0].id;
      const history = await loadA2uiHistory(workspace.id);
      a2uiSurfaces = history.surfaces;
      a2uiInspections = history.inspections;
    }
    const selectedFiles: WorkspaceFile[] = documents.map((document) => ({
      path: document.path,
      name: document.name,
      language: document.language,
      content: document.content,
      contentHash: document.contentHash,
      sizeBytes: document.sizeBytes,
      editable: document.editable,
      extracted: document.extracted,
      sourceId: document.sourceId,
    }));
    const selectedRecoveryDrafts = Object.fromEntries(
      documents
        .filter((document) => document.draft)
        .map((document) => [document.path, document.draft!])
    );
    set((state) => {
      const selectedPaths = selectedFiles.map((file) => file.path);
      const selectedEntries: WorkspaceFileEntry[] = selectedFiles.map((file) => ({
        path: file.path,
        name: file.name,
        language: file.language,
        sizeBytes: file.sizeBytes ?? 0,
        readable: true,
        editable: file.editable !== false,
        extracted: file.extracted === true,
        sourceId: file.sourceId,
      }));
      return {
        workspace,
        recentWorkspaces,
        sessions,
        activeSessionId,
        a2uiSurfaces,
        a2uiInspections,
        activeSurfaceId: a2uiSurfaces[0]?.surfaceId ?? '',
        activeInspectionId: a2uiInspections[0]?.id ?? '',
        centerView: 'editor',
        files: [
          ...state.files.filter((file) => !selectedPaths.includes(file.path)),
          ...selectedFiles,
        ],
        openPaths: [
          ...state.openPaths.filter((path) => !selectedPaths.includes(path)),
          ...selectedPaths,
        ],
        activePath: selectedPaths[0] ?? state.activePath,
        workspaceEntries: [
          ...state.workspaceEntries.filter((entry) => !selectedPaths.includes(entry.path)),
          ...selectedEntries,
        ],
        saveStatusByPath: {
          ...state.saveStatusByPath,
          ...Object.fromEntries(selectedPaths.map((path) => [path, 'saved' as const])),
          ...Object.fromEntries(
            recoveryDraftSummaries.map((draft) => [
              draft.relativePath,
              draft.conflict ? ('conflict' as const) : ('draft' as const),
            ])
          ),
        },
        recoveryDraftSummaries,
        recoveryDrafts:
          currentWorkspace?.id === workspace.id
            ? { ...state.recoveryDrafts, ...selectedRecoveryDrafts }
            : selectedRecoveryDrafts,
      };
    });
  },

  restoreWorkspace: async (workspaceId) => {
    if (get().runtimeMode === 'web-mock') return;
    await Promise.all(get().dirtyPaths.map((path) => get().persistDraft(path)));
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const workspace = await workspaceController.restore(workspaceId);
      const [workspaceEntries, a2uiHistory, recoveryDraftSummaries] = await Promise.all([
        workspaceController.listFiles(workspace.id),
        loadA2uiHistory(workspace.id),
        workspaceController.listRecoveryDrafts(workspace.id),
      ]);
      const { surfaces: a2uiSurfaces, inspections: a2uiInspections } = a2uiHistory;
      let sessions = await chatController.listSessions(workspace.id);
      if (sessions.length === 0) {
        sessions = [
          await chatController.createSession(workspace.id, crypto.randomUUID(), '新对话'),
        ];
      }
      set({
        workspace,
        workspaceEntries,
        files: [],
        openPaths: [],
        activePath: '',
        dirtyPaths: [],
        saveStatusByPath: Object.fromEntries(
          recoveryDraftSummaries.map((draft) => [
            draft.relativePath,
            draft.conflict ? 'conflict' : 'draft',
          ])
        ),
        recoveryDrafts: {},
        recoveryDraftSummaries,
        documentVersions: [],
        versionPreview: null,
        versionHistoryPath: '',
        versionHistoryLoading: false,
        versionHistoryError: null,
        sessions,
        activeSessionId: sessions[0].id,
        contextBySession: {},
        contextReviewKeyBySession: {},
        chatError: null,
        a2uiSurfaces,
        a2uiInspections,
        activeSurfaceId: a2uiSurfaces[0]?.surfaceId ?? '',
        activeInspectionId: a2uiInspections[0]?.id ?? '',
        a2uiNotice: null,
        centerView: 'editor',
      });
    } catch (error) {
      set({ workspaceError: errorDetails(error).message });
    } finally {
      set({ workspaceLoading: false });
    }
  },

  removeCurrentWorkspace: async () => {
    const workspace = get().workspace;
    if (!workspace || get().runtimeMode === 'web-mock') return;
    set({ workspaceLoading: true, workspaceError: null });
    try {
      await workspaceController.remove(workspace.id);
      const recentWorkspaces = await workspaceController.listRecent();
      set({
        workspace: null,
        recentWorkspaces,
        workspaceEntries: [],
        files: [],
        openPaths: [],
        activePath: '',
        dirtyPaths: [],
        saveStatusByPath: {},
        recoveryDrafts: {},
        recoveryDraftSummaries: [],
        documentVersions: [],
        versionPreview: null,
        versionHistoryPath: '',
        versionHistoryLoading: false,
        versionHistoryError: null,
        sessions: [],
        activeSessionId: '',
        contextBySession: {},
        contextReviewKeyBySession: {},
        chatRequestId: null,
        chatError: null,
        a2uiSurfaces: [],
        a2uiInspections: [],
        activeSurfaceId: '',
        activeInspectionId: '',
        a2uiNotice: null,
        centerView: 'editor',
      });
    } catch (error) {
      set({ workspaceError: errorDetails(error).message });
    } finally {
      set({ workspaceLoading: false });
    }
  },

  forgetAuthorizedSource: (sourceId) =>
    set((state) => {
      const removedPaths = new Set([
        ...state.files.filter((file) => file.sourceId === sourceId).map((file) => file.path),
        ...state.workspaceEntries
          .filter((entry) => entry.sourceId === sourceId)
          .map((entry) => entry.path),
      ]);
      const contextContainsSource = Object.values(state.contextBySession).some((context) =>
        context.documentSourceIds?.includes(sourceId)
      );
      if (removedPaths.size === 0 && !contextContainsSource) return state;
      const openPaths = state.openPaths.filter((path) => !removedPaths.has(path));
      const saveStatusByPath = { ...state.saveStatusByPath };
      const recoveryDrafts = { ...state.recoveryDrafts };
      for (const path of removedPaths) {
        delete saveStatusByPath[path];
        delete recoveryDrafts[path];
      }
      const clearingHistory = removedPaths.has(state.versionHistoryPath);
      return {
        workspaceEntries: state.workspaceEntries.filter((entry) => entry.sourceId !== sourceId),
        files: state.files.filter((file) => file.sourceId !== sourceId),
        openPaths,
        activePath: removedPaths.has(state.activePath)
          ? (openPaths.at(-1) ?? '')
          : state.activePath,
        dirtyPaths: state.dirtyPaths.filter((path) => !removedPaths.has(path)),
        saveStatusByPath,
        recoveryDrafts,
        recoveryDraftSummaries: state.recoveryDraftSummaries.filter(
          (draft) => !removedPaths.has(draft.relativePath)
        ),
        contextBySession: Object.fromEntries(
          Object.entries(state.contextBySession).map(([sessionId, context]) => [
            sessionId,
            {
              ...context,
              projectFiles: context.projectFiles.filter((path) => !removedPaths.has(path)),
              documentSourceIds: (context.documentSourceIds ?? []).filter((id) => id !== sourceId),
            },
          ])
        ),
        selectedText: removedPaths.has(state.activePath) ? '' : state.selectedText,
        documentVersions: clearingHistory ? [] : state.documentVersions,
        versionPreview: clearingHistory ? null : state.versionPreview,
        versionHistoryPath: clearingHistory ? '' : state.versionHistoryPath,
        versionHistoryLoading: clearingHistory ? false : state.versionHistoryLoading,
        versionHistoryError: clearingHistory ? null : state.versionHistoryError,
      };
    }),

  openFile: (path) => {
    if (get().runtimeMode === 'web-mock') {
      set((state) => ({
        activePath: path,
        selectedText: '',
        centerView: 'editor',
        openPaths: state.openPaths.includes(path) ? state.openPaths : [...state.openPaths, path],
      }));
      return;
    }
    const existing = get().files.find((file) => file.path === path);
    if (existing) {
      set((state) => ({
        activePath: path,
        selectedText: '',
        centerView: 'editor',
        openPaths: state.openPaths.includes(path) ? state.openPaths : [...state.openPaths, path],
      }));
      return;
    }
    const workspace = get().workspace;
    if (!workspace) return;
    set({ workspaceLoading: true, workspaceError: null });
    return (async () => {
      try {
        const document = await workspaceController.readFile(workspace.id, path);
        const draftHasConflict = Boolean(
          document.draft && document.draft.baseHash !== document.contentHash
        );
        const file: WorkspaceFile = {
          path: document.path,
          name: document.name,
          language: document.language,
          content: document.content,
          contentHash: document.contentHash,
          sizeBytes: document.sizeBytes,
          editable: document.editable,
          extracted: document.extracted,
          sourceId: document.sourceId,
        };
        set((state) => {
          const recoveryDrafts = { ...state.recoveryDrafts };
          if (document.draft) recoveryDrafts[path] = document.draft;
          else delete recoveryDrafts[path];
          const recoveryDraftSummaries = document.draft
            ? [
                {
                  relativePath: path,
                  baseHash: document.draft.baseHash,
                  updatedAt: document.draft.updatedAt,
                  currentHash: document.contentHash,
                  conflict: draftHasConflict,
                  available: true,
                },
                ...state.recoveryDraftSummaries.filter((draft) => draft.relativePath !== path),
              ]
            : state.recoveryDraftSummaries.filter((draft) => draft.relativePath !== path);
          return {
            files: [...state.files, file],
            openPaths: [...state.openPaths, path],
            activePath: path,
            selectedText: '',
            centerView: 'editor',
            dirtyPaths: state.dirtyPaths,
            saveStatusByPath: {
              ...state.saveStatusByPath,
              [path]: document.draft ? (draftHasConflict ? 'conflict' : 'draft') : 'saved',
            },
            recoveryDrafts,
            recoveryDraftSummaries,
          };
        });
      } catch (error) {
        set({ workspaceError: errorDetails(error).message });
      } finally {
        set({ workspaceLoading: false });
      }
    })();
  },

  closeFile: (path) =>
    set((state) => {
      const openPaths = state.openPaths.filter((item) => item !== path);
      return {
        openPaths,
        activePath: state.activePath === path ? (openPaths.at(-1) ?? '') : state.activePath,
      };
    }),

  updateFile: (path, content) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.path === path && file.editable !== false ? { ...file, content } : file
      ),
      dirtyPaths:
        state.files.find((file) => file.path === path)?.editable === false
          ? state.dirtyPaths
          : state.dirtyPaths.includes(path)
            ? state.dirtyPaths
            : [...state.dirtyPaths, path],
      saveStatusByPath:
        state.files.find((file) => file.path === path)?.editable === false
          ? state.saveStatusByPath
          : { ...state.saveStatusByPath, [path]: 'dirty' },
    })),

  persistDraft: async (path) => {
    const state = get();
    const workspace = state.workspace;
    const file = state.files.find((item) => item.path === path);
    if (state.runtimeMode === 'web-mock' || !file?.contentHash || file.editable === false) return;
    try {
      if (!workspace) return;
      await workspaceController.saveDraft(workspace.id, path, file.content, file.contentHash);
      set((current) => ({
        saveStatusByPath: { ...current.saveStatusByPath, [path]: 'draft' },
      }));
    } catch (error) {
      set((current) => ({
        workspaceError: errorDetails(error).message,
        saveStatusByPath: { ...current.saveStatusByPath, [path]: 'error' },
      }));
    }
  },

  saveFileToDisk: async (path) => {
    const state = get();
    const workspace = state.workspace;
    const file = state.files.find((item) => item.path === path);
    if (state.runtimeMode === 'web-mock') {
      get().markSaved(path);
      return;
    }
    if (!file?.contentHash || file.editable === false || !state.dirtyPaths.includes(path)) return;
    const content = file.content;
    const baseHash = file.contentHash;
    const sourceId = file.sourceId;
    set((current) => ({
      saveStatusByPath: { ...current.saveStatusByPath, [path]: 'saving' },
    }));
    try {
      const result = workspace
        ? await (async () => {
            await workspaceController.saveDraft(workspace.id, path, content, baseHash);
            return sourceId
              ? workspaceController.saveContextFile(sourceId, content, baseHash)
              : workspaceController.saveFile(workspace.id, path, content, baseHash);
          })()
        : null;
      if (!result) return;
      set((current) => {
        const recoveryDrafts = { ...current.recoveryDrafts };
        delete recoveryDrafts[path];
        const recoveryDraftSummaries = current.recoveryDraftSummaries.filter(
          (draft) => draft.relativePath !== path
        );
        const latestFile = current.files.find((item) => item.path === path);
        const unchangedSinceRequest =
          latestFile?.content === content && latestFile.contentHash === baseHash;
        return {
          files: current.files.map((item) =>
            item.path === path
              ? { ...item, contentHash: result.contentHash, sizeBytes: result.sizeBytes }
              : item
          ),
          dirtyPaths: unchangedSinceRequest
            ? current.dirtyPaths.filter((item) => item !== path)
            : current.dirtyPaths,
          saveStatusByPath: {
            ...current.saveStatusByPath,
            [path]: unchangedSinceRequest ? 'saved' : 'dirty',
          },
          recoveryDrafts,
          recoveryDraftSummaries,
        };
      });
      if (get().versionHistoryPath === path) {
        await get().loadDocumentVersions(path);
      }
    } catch (error) {
      const details = errorDetails(error);
      set((current) => ({
        workspaceError: details.message,
        saveStatusByPath: {
          ...current.saveStatusByPath,
          [path]: details.code === 'FILE_CONFLICT' ? 'conflict' : 'error',
        },
      }));
    }
  },

  restoreRecoveryDraft: (path) =>
    set((state) => {
      const draft = state.recoveryDrafts[path];
      if (!draft) return state;
      const recoveryDrafts = { ...state.recoveryDrafts };
      delete recoveryDrafts[path];
      return {
        files: state.files.map((file) =>
          file.path === path ? { ...file, content: draft.content } : file
        ),
        dirtyPaths: state.dirtyPaths.includes(path)
          ? state.dirtyPaths
          : [...state.dirtyPaths, path],
        saveStatusByPath: { ...state.saveStatusByPath, [path]: 'dirty' },
        recoveryDrafts,
        recoveryDraftSummaries: state.recoveryDraftSummaries.filter(
          (draft) => draft.relativePath !== path
        ),
      };
    }),

  discardRecoveryDraft: async (path) => {
    const workspace = get().workspace;
    if (!workspace || get().runtimeMode === 'web-mock') return;
    await workspaceController.discardDraft(workspace.id, path);
    set((state) => {
      const recoveryDrafts = { ...state.recoveryDrafts };
      delete recoveryDrafts[path];
      return {
        recoveryDrafts,
        recoveryDraftSummaries: state.recoveryDraftSummaries.filter(
          (draft) => draft.relativePath !== path
        ),
        saveStatusByPath: { ...state.saveStatusByPath, [path]: 'saved' },
      };
    });
  },

  loadDocumentVersions: async (path) => {
    const workspace = get().workspace;
    if (!workspace || get().runtimeMode === 'web-mock') return;
    set({
      versionHistoryPath: path,
      versionHistoryLoading: true,
      versionHistoryError: null,
    });
    try {
      const documentVersions = await workspaceController.listVersions(workspace.id, path);
      if (get().versionHistoryPath === path) set({ documentVersions });
    } catch (error) {
      set({ versionHistoryError: errorDetails(error).message });
    } finally {
      if (get().versionHistoryPath === path) set({ versionHistoryLoading: false });
    }
  },

  previewDocumentVersion: async (path, versionId) => {
    const workspace = get().workspace;
    if (!workspace || get().runtimeMode === 'web-mock') return;
    set({ versionHistoryLoading: true, versionHistoryError: null });
    try {
      const versionPreview = await workspaceController.readVersion(workspace.id, path, versionId);
      set({ versionPreview });
    } catch (error) {
      set({ versionHistoryError: errorDetails(error).message });
    } finally {
      set({ versionHistoryLoading: false });
    }
  },

  restoreDocumentVersion: async (path, versionId) => {
    const workspace = get().workspace;
    if (!workspace || get().runtimeMode === 'web-mock') return;
    if (get().dirtyPaths.includes(path)) {
      await get().saveFileToDisk(path);
      if (get().dirtyPaths.includes(path)) {
        set({ versionHistoryError: '当前修改尚未安全保存，无法恢复历史版本' });
        return;
      }
    }
    const file = get().files.find((item) => item.path === path);
    if (!file?.contentHash) return;
    set({ versionHistoryLoading: true, versionHistoryError: null });
    try {
      const preview = await workspaceController.readVersion(workspace.id, path, versionId);
      const restored = await workspaceController.restoreVersion(
        workspace.id,
        path,
        versionId,
        file.contentHash
      );
      set((state) => {
        const recoveryDrafts = { ...state.recoveryDrafts };
        delete recoveryDrafts[path];
        return {
          files: state.files.map((item) =>
            item.path === path
              ? {
                  ...item,
                  content: preview.content,
                  contentHash: restored.contentHash,
                  sizeBytes: restored.sizeBytes,
                }
              : item
          ),
          dirtyPaths: state.dirtyPaths.filter((item) => item !== path),
          saveStatusByPath: { ...state.saveStatusByPath, [path]: 'saved' },
          recoveryDrafts,
          versionPreview: null,
        };
      });
      await get().loadDocumentVersions(path);
    } catch (error) {
      const details = errorDetails(error);
      set((state) => ({
        versionHistoryError: details.message,
        saveStatusByPath:
          details.code === 'FILE_CONFLICT'
            ? { ...state.saveStatusByPath, [path]: 'conflict' }
            : state.saveStatusByPath,
      }));
    } finally {
      set({ versionHistoryLoading: false });
    }
  },

  clearVersionPreview: () => set({ versionPreview: null }),

  markSaved: (path) =>
    set((state) => ({
      dirtyPaths: state.dirtyPaths.filter((item) => item !== path),
      saveStatusByPath: { ...state.saveStatusByPath, [path]: 'saved' },
    })),
  clearWorkspaceError: () => set({ workspaceError: null }),
  setCenterView: (centerView) => set({ centerView }),
});
