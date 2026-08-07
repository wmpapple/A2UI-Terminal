import { create } from 'zustand';
import { TextStreamBuffer } from '../features/chat/textStreamBuffer';
import { buildContextSnapshot } from '../features/context/contextSnapshot';
import { createMockDiff, mockFiles, mockSessions } from '../shared/mock/workspace';
import { desktopApi } from '../shared/platform/desktop';
import { getRuntimeMode, type RuntimeMode } from '../shared/platform/runtime';
import type {
  CenterView,
  ChatMessage,
  ChatSession,
  ContextSelection,
  DiffProposal,
  FileSaveStatus,
  ProviderConfig,
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

const errorDetails = (error: unknown): { code: string; message: string } => {
  if (typeof error === 'object' && error && 'code' in error && 'message' in error) {
    return {
      code: String(error.code),
      message: String(error.message),
    };
  }
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) };
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
  centerView: CenterView;
  sessions: ChatSession[];
  activeSessionId: string;
  pendingDiff: DiffProposal | null;
  selectedText: string;
  contextBySession: Record<string, ContextSelection>;
  providerConfigs: ProviderConfig[];
  activeProviderId: string;
  providerLoading: boolean;
  providerError: string | null;
  chatRequestId: string | null;
  chatError: string | null;
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
  applyDiff: () => void;
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
  centerView: 'editor',
  sessions: useMockWorkspace ? mockSessions : [],
  activeSessionId: useMockWorkspace ? 'welcome' : '',
  pendingDiff: null,
  selectedText: '',
  contextBySession: {},
  providerConfigs: [],
  activeProviderId: 'siliconflow',
  providerLoading: false,
  providerError: null,
  chatRequestId: null,
  chatError: null,

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
      const workspaceEntries = await desktopApi.listWorkspaceFiles(workspace.id);
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
        saveStatusByPath: {},
        recoveryDrafts: {},
        sessions,
        activeSessionId: sessions[0].id,
        contextBySession: {},
        chatError: null,
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
      let sessions = get().sessions;
      let activeSessionId = get().activeSessionId;
      if (!currentWorkspace || currentWorkspace.id !== workspace.id) {
        sessions = await desktopApi.listChatSessions(workspace.id);
        if (sessions.length === 0) {
          sessions = [
            await desktopApi.createChatSession(workspace.id, crypto.randomUUID(), '新对话'),
          ];
        }
        activeSessionId = sessions[0].id;
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
          },
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
      const workspaceEntries = await desktopApi.listWorkspaceFiles(workspace.id);
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
        saveStatusByPath: {},
        recoveryDrafts: {},
        sessions,
        activeSessionId: sessions[0].id,
        contextBySession: {},
        chatError: null,
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
        sessions: [],
        activeSessionId: '',
        contextBySession: {},
        chatRequestId: null,
        chatError: null,
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
        set((state) => ({
          files: [...state.files, file],
          openPaths: [...state.openPaths, path],
          activePath: path,
          selectedText: '',
          dirtyPaths: state.dirtyPaths,
          saveStatusByPath: {
            ...state.saveStatusByPath,
            [path]: document.draft ? (draftHasConflict ? 'conflict' : 'draft') : 'saved',
          },
          recoveryDrafts: document.draft
            ? { ...state.recoveryDrafts, [path]: document.draft }
            : state.recoveryDrafts,
        }));
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
      if (file.sourceId) return;
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
      const result = sourceId
        ? await desktopApi.saveContextFile(sourceId, content, baseHash)
        : workspace
          ? await (async () => {
              await desktopApi.saveWorkspaceDraft(workspace.id, path, content, baseHash);
              return desktopApi.saveWorkspaceFile(workspace.id, path, content, baseHash);
            })()
          : null;
      if (!result) return;
      set((current) => {
        const recoveryDrafts = { ...current.recoveryDrafts };
        delete recoveryDrafts[path];
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
        };
      });
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
        saveStatusByPath: { ...state.saveStatusByPath, [path]: 'saved' },
      };
    });
  },

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
  applyDiff: () => {
    const proposal = get().pendingDiff;
    if (!proposal) return;
    set((state) => ({
      files: state.files.map((file) =>
        file.path === proposal.path ? { ...file, content: proposal.after } : file
      ),
      dirtyPaths: state.dirtyPaths.includes(proposal.path)
        ? state.dirtyPaths
        : [...state.dirtyPaths, proposal.path],
      saveStatusByPath: { ...state.saveStatusByPath, [proposal.path]: 'dirty' },
      pendingDiff: null,
      centerView: 'editor',
    }));
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
      await desktopApi.saveProviderConfig(config);
      if (secret?.trim()) await desktopApi.setProviderSecret(config.id, secret.trim());
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
      if (result.content.startsWith(receivedContent)) {
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
        displayedContent === result.content ? displayedContent : result.content,
        result.status
      );
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
      if (get().chatRequestId === requestId) set({ chatRequestId: null });
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
      await desktopApi.stopChat(requestId);
    } catch (error) {
      set({ chatError: errorDetails(error).message });
    }
  },
}));
