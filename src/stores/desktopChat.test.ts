import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopApi } from '../shared/platform/desktop';
import { createMockA2ui } from '../shared/mock/workspace';
import { useAppStore } from './useAppStore';

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({
    runtimeMode: 'desktop',
    workspace: { id: 'workspace-1', name: 'Project', available: true, kind: 'directory' },
    files: [
      { path: 'src/main.ts', name: 'main.ts', language: 'ts', content: 'selected file' },
      { path: 'src/hidden.ts', name: 'hidden.ts', language: 'ts', content: 'not selected' },
    ],
    activePath: 'src/main.ts',
    selectedText: '',
    sessions: [{ id: 'session-1', title: 'New chat', messages: [] }],
    activeSessionId: 'session-1',
    activeProviderId: 'openai',
    providerConfigs: [
      {
        id: 'openai',
        kind: 'open_ai',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-5.6',
        temperature: 0.2,
        proxyUrl: null,
        configured: true,
        active: true,
      },
    ],
    chatRequestId: null,
    chatError: null,
    a2uiSurfaces: [],
    a2uiInspections: [],
    activeSurfaceId: '',
    activeInspectionId: '',
  });
});

describe('desktop chat state', () => {
  it('rejects sending before creating optimistic messages when no workspace is open', async () => {
    const stream = vi.spyOn(desktopApi, 'streamChat');
    useAppStore.setState({ workspace: null });

    await useAppStore.getState().sendChat(
      'Hello',
      {
        selection: false,
        currentFile: true,
        recentMessages: false,
        recentMessageCount: 3,
        projectFiles: [],
      },
      true
    );

    expect(stream).not.toHaveBeenCalled();
    expect(useAppStore.getState().sessions[0].messages).toEqual([]);
    expect(useAppStore.getState().chatRequestId).toBeNull();
    expect(useAppStore.getState().chatError).toBe('请先打开工作区');
  });

  it('streams a response and sends only explicitly selected file context', async () => {
    const stream = vi
      .spyOn(desktopApi, 'streamChat')
      .mockImplementation(async (request, onEvent) => {
        onEvent({
          type: 'delta',
          requestId: request.requestId,
          messageId: request.assistantMessageId,
          delta: 'Hello',
        });
        onEvent({
          type: 'complete',
          requestId: request.requestId,
          messageId: request.assistantMessageId,
        });
        return {
          requestId: request.requestId,
          messageId: request.assistantMessageId,
          content: 'Hello',
          status: 'complete',
          errorCode: null,
        };
      });

    await useAppStore.getState().sendChat(
      'Explain this file',
      {
        selection: false,
        currentFile: true,
        recentMessages: false,
        recentMessageCount: 3,
        projectFiles: [],
      },
      true
    );

    const request = stream.mock.calls[0][0];
    expect(request.contextSources.map((source) => source.label)).toEqual(['src/main.ts']);
    expect(JSON.stringify(request)).not.toContain('not selected');
    expect(useAppStore.getState().sessions[0].messages.at(-1)).toMatchObject({
      content: 'Hello',
      status: 'complete',
    });
  });

  it('forwards stop to the active backend request', async () => {
    const stop = vi.spyOn(desktopApi, 'stopChat').mockResolvedValue(true);
    useAppStore.setState({ chatRequestId: 'request-1' });

    await useAppStore.getState().stopChat();

    expect(stop).toHaveBeenCalledWith('request-1');
  });

  it('upserts a validated Surface without rebuilding unrelated surfaces', async () => {
    const incoming = createMockA2ui();
    const unrelated = {
      ...incoming.surface,
      surfaceId: 'unrelated',
      messageId: 'other-message',
    };
    useAppStore.setState({ a2uiSurfaces: [unrelated], a2uiInspections: [] });
    vi.spyOn(desktopApi, 'streamChat').mockImplementation(async (request, onEvent) => {
      onEvent({
        type: 'complete',
        requestId: request.requestId,
        messageId: request.assistantMessageId,
      });
      return {
        requestId: request.requestId,
        messageId: request.assistantMessageId,
        content: '{"type":"a2ui_surface"}',
        status: 'complete',
        errorCode: 'A2UI_READY',
        a2ui: incoming,
      };
    });

    await useAppStore.getState().sendChat(
      'Create a form',
      {
        selection: false,
        currentFile: false,
        recentMessages: false,
        recentMessageCount: 0,
        projectFiles: [],
      },
      true
    );

    const surfaces = useAppStore.getState().a2uiSurfaces;
    expect(surfaces).toHaveLength(2);
    expect(surfaces.find((surface) => surface.surfaceId === 'unrelated')).toBe(unrelated);
    expect(useAppStore.getState().centerView).toBe('surface');
  });

  it('updates declared form state optimistically while the desktop audit is pending', async () => {
    const mock = createMockA2ui();
    useAppStore.setState({
      a2uiSurfaces: [mock.surface],
      activeSurfaceId: mock.surface.surfaceId,
    });
    let resolveAction!: (value: {
      risk: 'low';
      decision: 'allowed';
      message: string;
      surface: typeof mock.surface;
    }) => void;
    vi.spyOn(desktopApi, 'executeA2uiAction').mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      })
    );

    const pending = useAppStore.getState().executeA2uiAction('name', 'change', '张三');
    expect(useAppStore.getState().a2uiSurfaces[0]?.data.name).toBe('张三');
    expect(useAppStore.getState().a2uiActionLoading).toBe(false);

    resolveAction({
      risk: 'low',
      decision: 'allowed',
      message: 'Action 已执行',
      surface: { ...mock.surface, data: { ...mock.surface.data, name: '张三' } },
    });
    await pending;
    expect(useAppStore.getState().a2uiSurfaces[0]?.data.name).toBe('张三');
  });
});
