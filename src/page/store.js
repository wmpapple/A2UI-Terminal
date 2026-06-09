import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const WELCOME_MESSAGE = {
  role: 'assistant',
  content: '你好，我是你的 A2UI 智能助手。你可以让我生成组件、整理文档，或者修改右侧工作区内容。',
};

const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createSession = (title = '新对话') => ({
  id: createId(),
  title,
  messages: [WELCOME_MESSAGE],
  isGenerating: false,
  activeRequestId: null,
});

const initialSession = {
  id: 'default-session',
  title: '默认对话',
  messages: [WELCOME_MESSAGE],
  isGenerating: false,
  activeRequestId: null,
};

const normalizeSession = (session) => ({
  ...session,
  messages: Array.isArray(session.messages) && session.messages.length > 0 ? session.messages : [WELCOME_MESSAGE],
  isGenerating: false,
  activeRequestId: null,
});

export const useChatStore = create(
  persist(
    (set, get) => ({
      documentContent: '# 欢迎来到工作区\n\n请在左侧向 AI 发送指令。生成的文档内容可以同步到这里。',

      sessions: [initialSession],
      activeSessionId: initialSession.id,

      getActiveSession: () => {
        const { sessions, activeSessionId } = get();
        return sessions.find((session) => session.id === activeSessionId) || sessions[0];
      },

      createSession: () => {
        const session = createSession('新对话');
        set((state) => ({
          sessions: [...state.sessions, session],
          activeSessionId: session.id,
        }));
        return session.id;
      },

      switchSession: (sessionId) =>
        set((state) => ({
          activeSessionId: state.sessions.some((session) => session.id === sessionId)
            ? sessionId
            : state.activeSessionId,
        })),

      deleteSession: (sessionId) =>
        set((state) => {
          if (state.sessions.length <= 1) return state;
          const sessions = state.sessions.filter((session) => session.id !== sessionId);
          const activeSessionId =
            state.activeSessionId === sessionId ? sessions[0].id : state.activeSessionId;
          return { sessions, activeSessionId };
        }),

      renameSession: (sessionId, title) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId ? { ...session, title } : session
          ),
        })),

      setDocumentContent: (contentOrUpdater) =>
        set((state) => ({
          documentContent:
            typeof contentOrUpdater === 'function'
              ? contentOrUpdater(state.documentContent)
              : contentOrUpdater,
        })),

      addMessage: (sessionId, message) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? { ...session, messages: [...session.messages, message] }
              : session
          ),
        })),

      appendContentToMessage: (sessionId, requestId, deltaContent) =>
        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId) return session;

            const messages = [...session.messages];
            let targetIndex = messages.findIndex(
              (message) => message.role === 'assistant' && message.requestId === requestId
            );

            if (targetIndex === -1) {
              for (let index = messages.length - 1; index >= 0; index -= 1) {
                if (messages[index].role === 'assistant') {
                  targetIndex = index;
                  break;
                }
              }
            }

            if (targetIndex === -1) return session;

            messages[targetIndex] = {
              ...messages[targetIndex],
              content: `${messages[targetIndex].content || ''}${deltaContent}`,
            };

            return { ...session, messages };
          }),
        })),

      setSessionGenerating: (sessionId, isGenerating, requestId = null) =>
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  isGenerating,
                  activeRequestId: isGenerating ? requestId : null,
                }
              : session
          ),
        })),
    }),
    {
      name: 'a2ui-storage',
      partialize: (state) => ({
        documentContent: state.documentContent,
        sessions: state.sessions.map(({ isGenerating, activeRequestId, ...session }) => session),
        activeSessionId: state.activeSessionId,
      }),
      merge: (persistedState, currentState) => {
        if (!persistedState) return currentState;

        if (Array.isArray(persistedState.sessions)) {
          const sessions = persistedState.sessions.map(normalizeSession);
          return {
            ...currentState,
            ...persistedState,
            sessions,
            activeSessionId:
              persistedState.activeSessionId && sessions.some((session) => session.id === persistedState.activeSessionId)
                ? persistedState.activeSessionId
                : sessions[0]?.id || currentState.activeSessionId,
          };
        }

        if (Array.isArray(persistedState.chatHistory)) {
          return {
            ...currentState,
            documentContent: persistedState.documentContent ?? currentState.documentContent,
            sessions: [
              {
                ...initialSession,
                messages: persistedState.chatHistory,
              },
            ],
            activeSessionId: initialSession.id,
          };
        }

        return { ...currentState, ...persistedState };
      },
    }
  )
);
