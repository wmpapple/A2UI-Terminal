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

    await useAppStore.getState().sendChat('Hello', 'manifest-1');

    expect(stream).not.toHaveBeenCalled();
    expect(useAppStore.getState().sessions[0].messages).toEqual([]);
    expect(useAppStore.getState().chatRequestId).toBeNull();
    expect(useAppStore.getState().chatError).toBe('请先打开工作区');
  });

  it('streams a response bound only to the confirmed context manifest', async () => {
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

    await useAppStore.getState().sendChat('Explain this file', 'manifest-2');

    const request = stream.mock.calls[0][0];
    expect(request.contextManifestId).toBe('manifest-2');
    expect(JSON.stringify(request)).not.toContain('selected file');
    expect(useAppStore.getState().sessions[0].messages.at(-1)).toMatchObject({
      content: 'Hello',
      status: 'complete',
    });
  });

  it('forwards stop to the active backend request', async () => {
    const stop = vi.spyOn(desktopApi, 'stopChat').mockResolvedValue(true);
    useAppStore.setState({
      chatRequestId: 'request-1',
      sessions: [
        {
          id: 'session-1',
          title: 'New chat',
          messages: [
            {
              id: 'assistant-1',
              role: 'assistant',
              content: 'partial',
              status: 'streaming',
              requestId: 'request-1',
            },
          ],
        },
      ],
    });

    await useAppStore.getState().stopChat();

    expect(stop).toHaveBeenCalledWith('request-1');
    expect(useAppStore.getState().chatRequestId).toBeNull();
    expect(useAppStore.getState().sessions[0].messages[0].status).toBe('stopped');
  });

  it('keeps the structured provider error code and fallback message', async () => {
    vi.spyOn(desktopApi, 'streamChat').mockImplementation(async (request, onEvent) => {
      onEvent({
        type: 'error',
        requestId: request.requestId,
        messageId: request.assistantMessageId,
        code: 'PROVIDER_RATE_LIMITED',
        message: 'Provider 请求过于频繁或额度不足（HTTP 429）',
        retryable: true,
        retryAfterSeconds: 8,
      });
      return {
        requestId: request.requestId,
        messageId: request.assistantMessageId,
        content: '',
        status: 'error',
        errorCode: 'PROVIDER_RATE_LIMITED',
        errorMessage: 'Provider 请求过于频繁或额度不足（HTTP 429）',
        retryable: true,
        retryAfterSeconds: 8,
      };
    });

    await useAppStore.getState().sendChat('Hello', 'manifest-3');

    expect(useAppStore.getState().chatError).toContain('HTTP 429');
    expect(useAppStore.getState().sessions[0].messages.at(-1)).toMatchObject({
      status: 'error',
      errorCode: 'PROVIDER_RATE_LIMITED',
    });
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

    await useAppStore.getState().sendChat('Create a form', 'manifest-4');

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
