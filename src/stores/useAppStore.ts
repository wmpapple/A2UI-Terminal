import { create } from 'zustand';
import { TextStreamBuffer } from '../features/chat/textStreamBuffer';
import { buildContextSnapshot } from '../features/context/contextSnapshot';
import { createMockA2ui, createMockDiff, mockFiles, mockSessions } from '../shared/mock/workspace';
import { desktopApi } from '../shared/platform/desktop';
import { getRuntimeMode, type RuntimeMode } from '../shared/platform/runtime';
import type {
  A2uiInspection,
  A2uiSurface,
  CenterView,
  ChatMessage,
  ChatSession,
  ContextSelection,
  DocumentVersion,
  DocumentVersionSummary,
  FileSaveStatus,
  PatchApplication,
  PatchReview,
  ProviderConfig,
  RecoveryDraftSummary,
  WorkspaceDraft,
  WorkspaceFile,
  WorkspaceFileEntry,
  WorkspaceSummary,
} from '../shared/types/domain';

const mockEntries: WorkspaceFileEntry[] = mockFiles.map((file) => ({
  path: file.path,
  name: file.name,
  language: file.language,
  sizeBytes: new TextEncoder().encode(file.content).length,
  readable: true,
  editable: true,
  extracted: false,
}));

const initialRuntimeMode = getRuntimeMode();
const useMockWorkspace = initialRuntimeMode === 'web-mock';
const locallyStoppedChatRequests = new Set<string>();

const errorDetails = (error: unknown): { code: string; message: string } => {
  if (typeof error === 'object' && error && 'code' in error && 'message' in error) {
    return {
      code: String(error.code),
      message: String(error.message),
    };
  }
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) };
};

const upsertA2uiSurface = (surfaces: A2uiSurface[], next: A2uiSurface): A2uiSurface[] =>
  surfaces.some((surface) => surface.surfaceId === next.surfaceId)
    ? surfaces.map((surface) => (surface.surfaceId === next.surfaceId ? next : surface))
    : [next, ...surfaces];

const findA2uiNode = (
  node: A2uiSurface['root'],
  componentId: string
): A2uiSurface['root'] | undefined =>
  node.id === componentId
    ? node
    : node.children.map((child) => findA2uiNode(child, componentId)).find(Boolean);

const loadA2uiHistory = async (
  workspaceId: string
): Promise<{ surfaces: A2uiSurface[]; inspections: A2uiInspection[] }> => {
  try {
    const [surfaces, inspections] = await Promise.all([
      desktopApi.listA2uiSurfaces(workspaceId),
      desktopApi.listA2uiInspections(workspaceId),
    ]);
    return { surfaces, inspections };
  } catch {
    return { surfaces: [], inspections: [] };
  }
};

interface AppState {
  runtimeMode: RuntimeMode;
  workspace: WorkspaceSummary | null;
  recentWorkspaces: WorkspaceSummary[];
  workspaceEntries: WorkspaceFileEntry[];
  workspaceLoading: boolean;
  workspaceError: string | null;
  files: WorkspaceFile[];
  openPaths: string[];
  activePath: string;
  dirtyPaths: string[];
  saveStatusByPath: Record<string, FileSaveStatus>;
  recoveryDrafts: Record<string, WorkspaceDraft>;
  recoveryDraftSummaries: RecoveryDraftSummary[];
  documentVersions: DocumentVersionSummary[];
  versionPreview: DocumentVersion | null;
  versionHistoryPath: string;
  versionHistoryLoading: boolean;
  versionHistoryError: string | null;
  centerView: CenterView;
  sessions: ChatSession[];
  activeSessionId: string;
  pendingDiff: PatchReview | null;
  lastPatchApplication: PatchApplication | null;
  patchBeforeByPath: Record<string, string>;
  patchApplying: boolean;
  patchError: string | null;
  selectedText: string;
  contextBySession: Record<string, ContextSelection>;
  providerConfigs: ProviderConfig[];
  activeProviderId: string;
  providerLoading: boolean;
  providerError: string | null;
  chatRequestId: string | null;
  chatError: string | null;
  a2uiSurfaces: A2uiSurface[];
  a2uiInspections: A2uiInspection[];
  activeSurfaceId: string;
  activeInspectionId: string;
  a2uiActionLoading: boolean;
  a2uiNotice: string | null;
  initializeWorkspace: () => Promise<void>;
  initializeProviders: () => Promise<void>;
  selectWorkspace: () => Promise<void>;
  selectContextFiles: () => Promise<void>;
  restoreWorkspace: (workspaceId: string) => Promise<void>;
  removeCurrentWorkspace: () => Promise<void>;
  openFile: (path: string) => void | Promise<void>;
  closeFile: (path: string) => void;
  updateFile: (path: string, content: string) => void;
  persistDraft: (path: string) => Promise<void>;
  saveFileToDisk: (path: string) => Promise<void>;
  restoreRecoveryDraft: (path: string) => void;
  discardRecoveryDraft: (path: string) => Promise<void>;
  loadDocumentVersions: (path: string) => Promise<void>;
  previewDocumentVersion: (path: string, versionId: string) => Promise<void>;
  restoreDocumentVersion: (path: string, versionId: string) => Promise<void>;
  clearVersionPreview: () => void;
  markSaved: (path: string) => void;
  clearWorkspaceError: () => void;
  setCenterView: (view: CenterView) => void;
  createSession: () => Promise<void>;
  selectSession: (id: string) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateMessage: (
    sessionId: string,
    messageId: string,
    content: string,
    status?: ChatMessage['status']
  ) => void;
  createProposal: () => void;
  rejectDiff: () => void;
  togglePatchChange: (changeId: string) => void;
  applyDiff: () => Promise<void>;
  undoLastPatch: () => Promise<void>;
  setSelectedText: (text: string) => void;
  setSessionContext: (sessionId: string, context: ContextSelection) => void;
  addFileToContext: (sessionId: string, path: string) => void;
  addFile: (file: WorkspaceFile) => void;
  saveProvider: (config: ProviderConfig, secret?: string) => Promise<void>;
  selectProvider: (providerId: string) => Promise<void>;
  deleteProviderKey: (providerId: string) => Promise<void>;
  testProvider: (providerId: string) => Promise<number>;
  sendChat: (
    prompt: string,
    context: ContextSelection,
    sensitiveConfirmed: boolean
  ) => Promise<void>;
  stopChat: () => Promise<void>;
  setActiveSurface: (surfaceId: string) => void;
  setActiveInspection: (inspectionId: string) => void;
  executeA2uiAction: (componentId: string, eventName: string, payload: unknown) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  runtimeMode: initialRuntimeMode,
  workspace: null,
  recentWorkspaces: [],
  workspaceEntries: useMockWorkspace ? mockEntries : [],
  workspaceLoading: false,
  workspaceError: null,
  files: useMockWorkspace ? mockFiles : [],
  openPaths: useMockWorkspace ? ['README.md', 'src/experiment.ts'] : [],
  activePath: useMockWorkspace ? 'README.md' : '',
  dirtyPaths: [],
  saveStatusByPath: {},
  recoveryDrafts: {},
  recoveryDraftSummaries: [],
  documentVersions: [],
  versionPreview: null,
  versionHistoryPath: '',
  versionHistoryLoading: false,
  versionHistoryError: null,
  centerView: 'editor',
  sessions: useMockWorkspace ? mockSessions : [],
  activeSessionId: useMockWorkspace ? 'welcome' : '',
  pendingDiff: null,
  lastPatchApplication: null,
  patchBeforeByPath: {},
  patchApplying: false,
  patchError: null,
  selectedText: '',
  contextBySession: {},
  providerConfigs: [],
  activeProviderId: 'siliconflow',
  providerLoading: false,
  providerError: null,
  chatRequestId: null,
  chatError: null,
  a2uiSurfaces: [],
  a2uiInspections: [],
  activeSurfaceId: '',
  activeInspectionId: '',
  a2uiActionLoading: false,
  a2uiNotice: null,

  initializeWorkspace: async () => {
    if (get().runtimeMode === 'web-mock') return;
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const recentWorkspaces = await desktopApi.listRecentWorkspaces();
      set({ recentWorkspaces });
      const firstAvailable = recentWorkspaces.find((item) => item.available);
      if (firstAvailable) await get().restoreWorkspace(firstAvailable.id);
    } catch (error) {
      set({ workspaceError: errorDetails(error).message });
    } finally {
      set({ workspaceLoading: false });
    }
  },

  initializeProviders: async () => {
    if (get().runtimeMode === 'web-mock') return;
    set({ providerLoading: true, providerError: null });
    try {
      const providerConfigs = await desktopApi.listProviderConfigs();
      set({
        providerConfigs,
        activeProviderId: providerConfigs.find((config) => config.active)?.id ?? 'siliconflow',
      });
    } catch (error) {
      set({ providerError: errorDetails(error).message });
    } finally {
      set({ providerLoading: false });
    }
  },

  selectWorkspace: async () => {
    if (get().runtimeMode === 'web-mock') return;
    await Promise.all(get().dirtyPaths.map((path) => get().persistDraft(path)));
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const workspace = await desktopApi.selectWorkspace();
      if (!workspace) return;
      const [workspaceEntries, a2uiHistory, recoveryDraftSummaries] = await Promise.all([
        desktopApi.listWorkspaceFiles(workspace.id),
        loadA2uiHistory(workspace.id),
        desktopApi.listRecoveryDrafts(workspace.id),
      ]);
      const { surfaces: a2uiSurfaces, inspections: a2uiInspections } = a2uiHistory;
      const recentWorkspaces = await desktopApi.listRecentWorkspaces();
      let sessions = await desktopApi.listChatSessions(workspace.id);
      if (sessions.length === 0) {
        sessions = [
          await desktopApi.createChatSession(workspace.id, crypto.randomUUID(), '新对话'),
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
        chatError: null,
        a2uiSurfaces,
        a2uiInspections,
        activeSurfaceId: a2uiSurfaces[0]?.surfaceId ?? '',
        activeInspectionId: a2uiInspections[0]?.id ?? '',
        a2uiNotice: null,
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
      const result = await desktopApi.selectContextFiles(currentWorkspace?.id);
      if (!result || result.documents.length === 0) return;
      const { workspace, documents } = result;
      const recentWorkspaces = await desktopApi.listRecentWorkspaces();
      const recoveryDraftSummaries = await desktopApi.listRecoveryDrafts(workspace.id);
      let sessions = get().sessions;
      let activeSessionId = get().activeSessionId;
      let a2uiSurfaces = get().a2uiSurfaces;
      let a2uiInspections = get().a2uiInspections;
      if (!currentWorkspace || currentWorkspace.id !== workspace.id) {
        sessions = await desktopApi.listChatSessions(workspace.id);
        if (sessions.length === 0) {
          sessions = [
            await desktopApi.createChatSession(workspace.id, crypto.randomUUID(), '新对话'),
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

  restoreWorkspace: async (workspaceId) => {
    if (get().runtimeMode === 'web-mock') return;
    await Promise.all(get().dirtyPaths.map((path) => get().persistDraft(path)));
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const workspace = await desktopApi.restoreWorkspace(workspaceId);
      const [workspaceEntries, a2uiHistory, recoveryDraftSummaries] = await Promise.all([
        desktopApi.listWorkspaceFiles(workspace.id),
        loadA2uiHistory(workspace.id),
        desktopApi.listRecoveryDrafts(workspace.id),
      ]);
      const { surfaces: a2uiSurfaces, inspections: a2uiInspections } = a2uiHistory;
      let sessions = await desktopApi.listChatSessions(workspace.id);
      if (sessions.length === 0) {
        sessions = [
          await desktopApi.createChatSession(workspace.id, crypto.randomUUID(), '新对话'),
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
        chatError: null,
        a2uiSurfaces,
        a2uiInspections,
        activeSurfaceId: a2uiSurfaces[0]?.surfaceId ?? '',
        activeInspectionId: a2uiInspections[0]?.id ?? '',
        a2uiNotice: null,
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
      await desktopApi.removeWorkspace(workspace.id);
      const recentWorkspaces = await desktopApi.listRecentWorkspaces();
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
        chatRequestId: null,
        chatError: null,
        a2uiSurfaces: [],
        a2uiInspections: [],
        activeSurfaceId: '',
        activeInspectionId: '',
        a2uiNotice: null,
      });
    } catch (error) {
      set({ workspaceError: errorDetails(error).message });
    } finally {
      set({ workspaceLoading: false });
    }
  },

  openFile: (path) => {
    if (get().runtimeMode === 'web-mock') {
      set((state) => ({
        activePath: path,
        selectedText: '',
        openPaths: state.openPaths.includes(path) ? state.openPaths : [...state.openPaths, path],
      }));
      return;
    }
    const existing = get().files.find((file) => file.path === path);
    if (existing) {
      set((state) => ({
        activePath: path,
        selectedText: '',
        openPaths: state.openPaths.includes(path) ? state.openPaths : [...state.openPaths, path],
      }));
      return;
    }
    const workspace = get().workspace;
    if (!workspace) return;
    set({ workspaceLoading: true, workspaceError: null });
    return (async () => {
      try {
        const document = await desktopApi.readWorkspaceFile(workspace.id, path);
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
      await desktopApi.saveWorkspaceDraft(workspace.id, path, file.content, file.contentHash);
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
            await desktopApi.saveWorkspaceDraft(workspace.id, path, content, baseHash);
            return sourceId
              ? desktopApi.saveContextFile(sourceId, content, baseHash)
              : desktopApi.saveWorkspaceFile(workspace.id, path, content, baseHash);
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
    await desktopApi.discardWorkspaceDraft(workspace.id, path);
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
      const documentVersions = await desktopApi.listDocumentVersions(workspace.id, path);
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
      const versionPreview = await desktopApi.readDocumentVersion(workspace.id, path, versionId);
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
      const preview = await desktopApi.readDocumentVersion(workspace.id, path, versionId);
      const restored = await desktopApi.restoreDocumentVersion(
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
  createSession: async () => {
    const id = crypto.randomUUID();
    const workspace = get().workspace;
    if (get().runtimeMode === 'desktop') {
      if (!workspace) return;
      try {
        const session = await desktopApi.createChatSession(workspace.id, id, '新对话');
        set((state) => ({
          activeSessionId: id,
          sessions: [session, ...state.sessions],
        }));
      } catch (error) {
        set({ chatError: errorDetails(error).message });
      }
      return;
    }
    set((state) => ({
      activeSessionId: id,
      sessions: [...state.sessions, { id, title: '新对话', messages: [] }],
    }));
  },
  selectSession: (activeSessionId) => set({ activeSessionId }),
  addMessage: (sessionId, message) =>
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? { ...session, messages: [...session.messages, message] }
          : session
      ),
    })),
  updateMessage: (sessionId, messageId, content, status) =>
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: session.messages.map((message) =>
                message.id === messageId
                  ? { ...message, content, status: status ?? message.status }
                  : message
              ),
            }
          : session
      ),
    })),
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
      const application = await desktopApi.applyDocumentPatch({
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
      const undone = await desktopApi.undoDocumentPatch(workspace.id, application.operationId);
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
  setSelectedText: (selectedText) => set({ selectedText }),
  setSessionContext: (sessionId, context) =>
    set((state) => ({
      contextBySession: { ...state.contextBySession, [sessionId]: context },
    })),
  addFileToContext: (sessionId, path) =>
    set((state) => {
      const current = state.contextBySession[sessionId] ?? {
        selection: false,
        currentFile: true,
        recentMessages: true,
        recentMessageCount: 3,
        projectFiles: [],
      };
      if (current.projectFiles.includes(path)) return state;
      return {
        contextBySession: {
          ...state.contextBySession,
          [sessionId]: { ...current, projectFiles: [...current.projectFiles, path] },
        },
      };
    }),
  addFile: (file) =>
    set((state) => ({
      files: state.files.some((item) => item.path === file.path)
        ? state.files.map((item) => (item.path === file.path ? file : item))
        : [...state.files, file],
    })),

  saveProvider: async (config, secret) => {
    if (get().runtimeMode === 'web-mock') return;
    set({ providerLoading: true, providerError: null });
    try {
      await desktopApi.saveProviderConfig(config, secret?.trim() || undefined);
      await get().initializeProviders();
    } catch (error) {
      const details = errorDetails(error);
      set({ providerError: details.message });
      throw new Error(details.message);
    } finally {
      set({ providerLoading: false });
    }
  },

  selectProvider: async (providerId) => {
    if (get().runtimeMode === 'web-mock') return;
    try {
      await desktopApi.setActiveProvider(providerId);
      set((state) => ({
        activeProviderId: providerId,
        providerConfigs: state.providerConfigs.map((config) => ({
          ...config,
          active: config.id === providerId,
        })),
      }));
    } catch (error) {
      set({ providerError: errorDetails(error).message });
    }
  },

  deleteProviderKey: async (providerId) => {
    if (get().runtimeMode === 'web-mock') return;
    set({ providerLoading: true, providerError: null });
    try {
      await desktopApi.deleteProviderSecret(providerId);
      await get().initializeProviders();
    } catch (error) {
      set({ providerError: errorDetails(error).message });
    } finally {
      set({ providerLoading: false });
    }
  },

  testProvider: async (providerId) => {
    if (get().runtimeMode === 'web-mock') return 0;
    set({ providerLoading: true, providerError: null });
    try {
      const result = await desktopApi.testProviderConnection(providerId);
      return result.latencyMs;
    } catch (error) {
      const message = errorDetails(error).message;
      set({ providerError: message });
      throw new Error(message);
    } finally {
      set({ providerLoading: false });
    }
  },

  sendChat: async (prompt, context, sensitiveConfirmed) => {
    const state = get();
    const workspace = state.workspace;
    if (state.runtimeMode === 'desktop' && !workspace) {
      set({ chatError: '请先打开工作区' });
      return;
    }
    const session = state.sessions.find((item) => item.id === state.activeSessionId);
    if (!session || !prompt.trim() || state.chatRequestId) return;
    const snapshot = buildContextSnapshot({
      selection: context,
      files: state.files,
      activePath: state.activePath,
      selectedText: state.selectedText,
      recentMessages: session.messages,
      prompt,
    });
    const requestId = crypto.randomUUID();
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const providerId = state.activeProviderId;
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: prompt.trim(),
      status: 'complete',
      requestId,
      providerId,
    };
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      requestId,
      providerId,
    };
    set((current) => ({
      chatRequestId: requestId,
      chatError: null,
      sessions: current.sessions.map((item) =>
        item.id === session.id
          ? {
              ...item,
              title: item.messages.length === 0 ? prompt.trim().slice(0, 36) : item.title,
              messages: [...item.messages, userMessage, assistantMessage],
            }
          : item
      ),
    }));

    if (state.runtimeMode === 'web-mock') {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      if (get().chatRequestId !== requestId) return;
      if (/\b(a2ui|surface|form|dashboard)\b|界面|表单|仪表盘/i.test(prompt)) {
        const mock = createMockA2ui();
        get().updateMessage(
          session.id,
          assistantMessageId,
          'Mock A2UI Surface is ready for the trusted runtime.',
          'complete'
        );
        set((current) => ({
          chatRequestId: null,
          a2uiSurfaces: upsertA2uiSurface(current.a2uiSurfaces, mock.surface),
          a2uiInspections: [
            mock.inspection,
            ...current.a2uiInspections.filter((item) => item.id !== mock.inspection.id),
          ],
          activeSurfaceId: mock.surface.surfaceId,
          activeInspectionId: mock.inspection.id,
          centerView: 'surface',
          a2uiNotice: null,
        }));
        return;
      }
      get().updateMessage(
        session.id,
        assistantMessageId,
        'Mock response: context confirmed. A review proposal is ready.',
        'complete'
      );
      set({ chatRequestId: null });
      get().createProposal();
      return;
    }
    if (!workspace) return;
    let receivedContent = '';
    let terminalReceived = false;
    let resolveTerminal: (() => void) | undefined;
    const terminalEvent = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });
    const markTerminal = () => {
      terminalReceived = true;
      resolveTerminal?.();
    };
    const textBuffer = new TextStreamBuffer((delta) => {
      set((current) => ({
        sessions: current.sessions.map((item) =>
          item.id === session.id
            ? {
                ...item,
                messages: item.messages.map((message) =>
                  message.id === assistantMessageId
                    ? { ...message, content: message.content + delta }
                    : message
                ),
              }
            : item
        ),
      }));
    });
    try {
      const result = await desktopApi.streamChat(
        {
          requestId,
          userMessageId,
          assistantMessageId,
          workspaceId: workspace.id,
          sessionId: session.id,
          providerId,
          prompt: prompt.trim(),
          recentMessageCount: context.recentMessages ? context.recentMessageCount : 0,
          contextSources: snapshot.sources,
          sensitiveConfirmed,
        },
        (event) => {
          if (event.type === 'delta') {
            if (locallyStoppedChatRequests.has(requestId)) return;
            receivedContent += event.delta;
            textBuffer.push(event.delta);
          } else if (event.type === 'error') {
            set({ chatError: event.message });
            markTerminal();
          } else {
            markTerminal();
          }
        }
      );
      if (!terminalReceived) {
        await Promise.race([
          terminalEvent,
          new Promise<void>((resolve) => window.setTimeout(resolve, 2000)),
        ]);
      }
      const locallyStopped = locallyStoppedChatRequests.has(requestId);
      if (!locallyStopped && result.content.startsWith(receivedContent)) {
        textBuffer.push(result.content.slice(receivedContent.length));
      }
      await textBuffer.finish();
      const displayedContent =
        get()
          .sessions.find((item) => item.id === session.id)
          ?.messages.find((message) => message.id === assistantMessageId)?.content ?? '';
      get().updateMessage(
        session.id,
        assistantMessageId,
        locallyStopped || displayedContent === result.content ? displayedContent : result.content,
        locallyStopped ? 'stopped' : result.status
      );
      if (result.status === 'error' && result.errorMessage) {
        set({ chatError: result.errorMessage });
      }
      if (result.errorCode || result.patchError) {
        set((current) => ({
          sessions: current.sessions.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  messages: item.messages.map((message) =>
                    message.id === assistantMessageId
                      ? {
                          ...message,
                          errorCode: result.errorCode,
                          protocolError: result.patchError,
                        }
                      : message
                  ),
                }
              : item
          ),
        }));
      }
      if (result.patch) {
        set({ pendingDiff: result.patch, centerView: 'diff', patchError: null });
      }
      if (result.a2ui) {
        set((current) => ({
          a2uiSurfaces: result.a2ui?.surface
            ? upsertA2uiSurface(current.a2uiSurfaces, result.a2ui.surface)
            : current.a2uiSurfaces,
          a2uiInspections: [
            result.a2ui!.inspection,
            ...current.a2uiInspections.filter(
              (inspection) => inspection.id !== result.a2ui!.inspection.id
            ),
          ],
          activeSurfaceId: result.a2ui?.surface?.surfaceId ?? current.activeSurfaceId,
          activeInspectionId: result.a2ui!.inspection.id,
          centerView: 'surface',
          a2uiNotice: result.a2ui!.inspection.validation.valid
            ? null
            : result.a2ui!.inspection.validation.errors.join('；'),
        }));
      }
    } catch (error) {
      await textBuffer.finish();
      const details = errorDetails(error);
      set({ chatError: details.message });
      set((current) => ({
        sessions: current.sessions.map((item) =>
          item.id === session.id
            ? {
                ...item,
                messages: item.messages.map((message) =>
                  message.id === assistantMessageId
                    ? { ...message, status: 'error', errorCode: details.code }
                    : message
                ),
              }
            : item
        ),
      }));
    } finally {
      locallyStoppedChatRequests.delete(requestId);
      if (get().chatRequestId === requestId) set({ chatRequestId: null });
    }
  },

  setActiveSurface: (activeSurfaceId) =>
    set((state) => ({
      activeSurfaceId,
      activeInspectionId:
        state.a2uiInspections.find((inspection) => inspection.surfaceId === activeSurfaceId)?.id ??
        state.activeInspectionId,
      centerView: 'surface',
    })),

  setActiveInspection: (activeInspectionId) =>
    set((state) => ({
      activeInspectionId,
      activeSurfaceId:
        state.a2uiInspections.find((inspection) => inspection.id === activeInspectionId)
          ?.surfaceId ?? state.activeSurfaceId,
      centerView: 'surface',
    })),

  executeA2uiAction: async (componentId, eventName, payload) => {
    const state = get();
    const surface = state.a2uiSurfaces.find((item) => item.surfaceId === state.activeSurfaceId);
    if (!surface) return;
    const action = findA2uiNode(surface.root, componentId)?.actions[eventName];
    const stateTarget =
      action?.type === 'set_state' && typeof action.target === 'string' ? action.target : null;
    set((current) => ({
      a2uiActionLoading: stateTarget ? current.a2uiActionLoading : true,
      a2uiNotice: null,
      a2uiSurfaces: stateTarget
        ? current.a2uiSurfaces.map((item) =>
            item.surfaceId === surface.surfaceId
              ? { ...item, data: { ...item.data, [stateTarget]: payload } }
              : item
          )
        : current.a2uiSurfaces,
    }));
    try {
      if (state.runtimeMode === 'web-mock') {
        const node = findA2uiNode(surface.root, componentId);
        const action = node?.actions[eventName];
        const decision = action
          ? action.type === 'request_patch'
            ? 'review_required'
            : 'allowed'
          : 'denied';
        const target = action?.target;
        const next: A2uiSurface = {
          ...surface,
          data:
            action?.type === 'set_state' && target
              ? { ...surface.data, [target]: payload }
              : surface.data,
          events: [
            {
              id: crypto.randomUUID(),
              componentId,
              eventName,
              actionType: action?.type ?? 'undeclared',
              risk:
                decision === 'denied' ? 'high' : decision === 'review_required' ? 'medium' : 'low',
              decision,
              payload,
              durationMs: 1,
              createdAt: new Date().toISOString(),
            },
            ...surface.events,
          ],
        };
        set((current) => ({
          a2uiSurfaces: upsertA2uiSurface(current.a2uiSurfaces, next),
          a2uiNotice:
            decision === 'review_required'
              ? '文件操作必须进入 Diff 审阅'
              : decision === 'denied'
                ? '未声明的 Action 已拒绝'
                : 'Action 已记录',
        }));
        return;
      }
      const workspace = state.workspace;
      if (!workspace) return;
      const result = await desktopApi.executeA2uiAction({
        workspaceId: workspace.id,
        surfaceId: surface.surfaceId,
        componentId,
        eventName,
        payload,
      });
      set((current) => ({
        a2uiSurfaces: upsertA2uiSurface(
          current.a2uiSurfaces,
          stateTarget
            ? {
                ...result.surface,
                data: {
                  ...result.surface.data,
                  ...(current.a2uiSurfaces.find(
                    (item) => item.surfaceId === result.surface.surfaceId
                  )?.data ?? {}),
                },
              }
            : result.surface
        ),
        a2uiNotice: result.message,
        centerView:
          result.decision === 'review_required' && current.pendingDiff
            ? 'diff'
            : current.centerView,
      }));
    } catch (error) {
      set({ a2uiNotice: errorDetails(error).message });
    } finally {
      if (!stateTarget) set({ a2uiActionLoading: false });
    }
  },

  stopChat: async () => {
    const requestId = get().chatRequestId;
    if (!requestId) return;
    if (get().runtimeMode === 'web-mock') {
      set((state) => ({
        chatRequestId: null,
        sessions: state.sessions.map((session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.requestId === requestId && message.status === 'streaming'
              ? { ...message, status: 'stopped' }
              : message
          ),
        })),
      }));
      return;
    }
    try {
      const stopped = await desktopApi.stopChat(requestId);
      if (!stopped) return;
      locallyStoppedChatRequests.add(requestId);
      set((state) => ({
        chatRequestId: state.chatRequestId === requestId ? null : state.chatRequestId,
        sessions: state.sessions.map((session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.requestId === requestId && message.status === 'streaming'
              ? { ...message, status: 'stopped' }
              : message
          ),
        })),
      }));
    } catch (error) {
      set({ chatError: errorDetails(error).message });
    }
  },
}));
