import { create } from 'zustand';
import { createMockDiff, mockFiles, mockSessions } from '../shared/mock/workspace';
import type {
  CenterView,
  ChatMessage,
  ChatSession,
  DiffProposal,
  ContextSelection,
  WorkspaceFile,
} from '../shared/types/domain';

interface AppState {
  files: WorkspaceFile[];
  openPaths: string[];
  activePath: string;
  dirtyPaths: string[];
  centerView: CenterView;
  sessions: ChatSession[];
  activeSessionId: string;
  pendingDiff: DiffProposal | null;
  selectedText: string;
  contextBySession: Record<string, ContextSelection>;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  updateFile: (path: string, content: string) => void;
  markSaved: (path: string) => void;
  setCenterView: (view: CenterView) => void;
  createSession: () => void;
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
}

export const useAppStore = create<AppState>((set, get) => ({
  files: mockFiles,
  openPaths: ['README.md', 'src/experiment.ts'],
  activePath: 'README.md',
  dirtyPaths: [],
  centerView: 'editor',
  sessions: mockSessions,
  activeSessionId: 'welcome',
  pendingDiff: null,
  selectedText: '',
  contextBySession: {},

  openFile: (path) =>
    set((state) => ({
      activePath: path,
      selectedText: '',
      openPaths: state.openPaths.includes(path) ? state.openPaths : [...state.openPaths, path],
    })),
  closeFile: (path) =>
    set((state) => {
      const openPaths = state.openPaths.filter((item) => item !== path);
      return {
        openPaths,
        activePath: state.activePath === path ? (openPaths[0] ?? '') : state.activePath,
      };
    }),
  updateFile: (path, content) =>
    set((state) => ({
      files: state.files.map((file) => (file.path === path ? { ...file, content } : file)),
      dirtyPaths: state.dirtyPaths.includes(path) ? state.dirtyPaths : [...state.dirtyPaths, path],
    })),
  markSaved: (path) =>
    set((state) => ({ dirtyPaths: state.dirtyPaths.filter((item) => item !== path) })),
  setCenterView: (centerView) => set({ centerView }),
  createSession: () => {
    const id = crypto.randomUUID();
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
}));
