import { TextStreamBuffer } from './textStreamBuffer';
import { createMockA2ui } from '../../shared/mock/workspace';
import type { ChatMessage } from '../../shared/types/domain';
import { errorDetails, locallyStoppedChatRequests, upsertA2uiSurface } from '../../stores/support';
import type { AppGet, AppSet, AppState } from '../../stores/types';
import { chatController } from './chatController';

type ChatActions = Pick<
  AppState,
  | 'createSession'
  | 'selectSession'
  | 'addMessage'
  | 'updateMessage'
  | 'setSelectedText'
  | 'setSessionContext'
  | 'setSessionContextReviewKey'
  | 'invalidateContextReviewsForProviderChange'
  | 'addFileToContext'
  | 'addFile'
  | 'sendChat'
  | 'stopChat'
>;

export const createChatStore = (set: AppSet, get: AppGet): ChatActions => ({
  createSession: async () => {
    const id = crypto.randomUUID();
    const workspace = get().workspace;
    if (get().runtimeMode === 'desktop') {
      if (!workspace) return;
      try {
        const session = await chatController.createSession(workspace.id, id, '新对话');
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

  setSelectedText: (selectedText) => set({ selectedText }),
  setSessionContext: (sessionId, context) =>
    set((state) => ({
      contextBySession: { ...state.contextBySession, [sessionId]: context },
    })),
  setSessionContextReviewKey: (sessionId, reviewKey) =>
    set((state) => ({
      contextReviewKeyBySession: {
        ...state.contextReviewKeyBySession,
        [sessionId]: reviewKey,
      },
    })),
  invalidateContextReviewsForProviderChange: () =>
    set((state) => {
      const contextReviewKeyBySession = { ...state.contextReviewKeyBySession };
      state.sessions.forEach((session) => {
        if (session.messages.some((chatMessage) => chatMessage.role === 'user')) {
          contextReviewKeyBySession[session.id] = 'provider-configuration-changed';
        }
      });
      return { contextReviewKeyBySession };
    }),
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

  sendChat: async (prompt, contextManifestId) => {
    const state = get();
    const workspace = state.workspace;
    if (state.runtimeMode === 'desktop' && !workspace) {
      set({ chatError: '请先打开工作区' });
      return;
    }
    const session = state.sessions.find((item) => item.id === state.activeSessionId);
    if (!session || !prompt.trim() || state.chatRequestId) return;
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
      const result = await chatController.stream(
        {
          requestId,
          userMessageId,
          assistantMessageId,
          workspaceId: workspace.id,
          sessionId: session.id,
          providerId,
          prompt: prompt.trim(),
          contextManifestId,
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
      const stopped = await chatController.stop(requestId);
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
});
