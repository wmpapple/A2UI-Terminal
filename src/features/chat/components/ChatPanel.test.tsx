import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useAppStore } from '../../../stores/useAppStore';
import { chatController } from '../chatController';
import { ChatPanel } from './ChatPanel';

const rawProtocol = '{"version":"1.0","type":"document_patch","changes":["MACHINE_ONLY_PROTOCOL"]';
const originalSendChat = useAppStore.getState().sendChat;
const plannerFields = {
  strategy: 'full' as const,
  indexMode: 'none' as const,
  tokenBudget: 32000,
  retrievedChunkCount: 0,
};

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({
    sessions: [
      {
        id: 'session',
        title: 'test',
        messages: [
          {
            id: 'assistant',
            role: 'assistant',
            content: rawProtocol,
            status: 'streaming',
          },
        ],
      },
    ],
    activeSessionId: 'session',
    activePath: '',
    files: [],
    selectedText: '',
    providerConfigs: [],
    activeProviderId: '',
    chatRequestId: 'request',
    chatError: null,
    pendingDiff: null,
    contextBySession: {},
    contextReviewKeyBySession: {},
    runtimeMode: 'web-mock',
    sendChat: originalSendChat,
  });
});

describe('ChatPanel patch presentation', () => {
  it('hides streaming machine protocol behind a human-readable progress state', () => {
    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );

    expect(screen.getByText('正在生成修改方案')).toBeInTheDocument();
    expect(screen.queryByText(/MACHINE_ONLY_PROTOCOL/)).not.toBeInTheDocument();
  });

  it('never exposes raw protocol as the completed assistant answer', () => {
    useAppStore.setState((state) => ({
      sessions: state.sessions.map((session) => ({
        ...session,
        messages: session.messages.map((message) => ({
          ...message,
          status: 'complete' as const,
          errorCode: 'PATCH_READY',
        })),
      })),
      chatRequestId: null,
    }));
    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );

    expect(screen.getByText('AI 已生成文件修改方案')).toBeInTheDocument();
    expect(screen.queryByText(/MACHINE_ONLY_PROTOCOL/)).not.toBeInTheDocument();
  });

  it('shows the trusted backend reason when patch validation fails', () => {
    useAppStore.setState((state) => ({
      sessions: state.sessions.map((session) => ({
        ...session,
        messages: session.messages.map((message) => ({
          ...message,
          status: 'complete' as const,
          errorCode: 'PATCH_VALIDATION_FAILED',
          protocolError:
            'AI 修改方案未通过安全校验：invalid input: 目标文件不存在或未获当前工作区授权：TRAVEL_GUIDE.md',
        })),
      })),
      chatRequestId: null,
    }));

    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );

    expect(screen.getByText('AI 修改方案未通过安全校验')).toBeInTheDocument();
    expect(screen.getByText('具体原因：')).toBeInTheDocument();
    expect(
      screen.getByText('目标文件不存在或未获当前工作区授权：TRAVEL_GUIDE.md')
    ).toBeInTheDocument();
    expect(screen.queryByText(/invalid input:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MACHINE_ONLY_PROTOCOL/)).not.toBeInTheDocument();
  });

  it('explains the empty-file limitation without claiming an automatic retry', () => {
    useAppStore.setState((state) => ({
      sessions: state.sessions.map((session) => ({
        ...session,
        messages: session.messages.map((message) => ({
          ...message,
          status: 'complete' as const,
          errorCode: 'PATCH_VALIDATION_FAILED',
          protocolError:
            'AI 修改方案未通过安全校验：invalid input: 目标文件为空，当前版本暂不支持 AI 直接写入；请先手动添加并保存一行内容后重试',
        })),
      })),
      chatRequestId: null,
    }));

    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );

    expect(screen.getByText(/目标文件已经成功授权，但它是空文件/)).toBeInTheDocument();
    expect(screen.getByText(/系统没有再次请求模型/)).toBeInTheDocument();
    expect(screen.queryByText(/系统已自动重试/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('blocks an unverified claim that a document was created', () => {
    useAppStore.setState({
      sessions: [
        {
          id: 'session',
          title: 'test',
          messages: [
            {
              id: 'assistant',
              role: 'assistant',
              content: '您好！我已经为您创建了一个基础出游指南文档。',
              status: 'complete',
              errorCode: 'UNVERIFIED_FILE_COMPLETION_CLAIM',
            },
          ],
        },
      ],
      chatRequestId: null,
    });

    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );

    expect(screen.getByText('文件并未创建或修改')).toBeInTheDocument();
    expect(screen.getByText(/系统没有收到可验证的文件操作凭证/)).toBeInTheDocument();
    expect(screen.queryByText(/我已经为您创建/)).not.toBeInTheDocument();
  });

  it('explains that new-file creation is unavailable without rendering model output', () => {
    useAppStore.setState({
      sessions: [
        {
          id: 'session',
          title: 'test',
          messages: [
            {
              id: 'assistant',
              role: 'assistant',
              content: '当前版本尚不支持直接新建文件；没有文件被创建。',
              status: 'complete',
              errorCode: 'FILE_CREATION_NOT_AVAILABLE',
            },
          ],
        },
      ],
      chatRequestId: null,
    });

    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );

    expect(screen.getByText('当前版本尚不支持直接新建文件')).toBeInTheDocument();
    expect(screen.getByText(/没有文件被创建/)).toBeInTheDocument();
    expect(screen.queryByText(/当前版本尚不支持直接新建文件；/)).not.toBeInTheDocument();
  });

  it('renders ordinary assistant Markdown as a safe formatted preview', () => {
    useAppStore.setState({
      sessions: [
        {
          id: 'session',
          title: 'test',
          messages: [
            {
              id: 'assistant',
              role: 'assistant',
              content:
                '# 项目总结\n\n这是 **核心能力**。\n\n- 文件选择\n- 安全修改\n\n<script>MACHINE_ONLY_HTML</script>',
              status: 'complete',
            },
          ],
        },
      ],
      chatRequestId: null,
    });

    const { container } = render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );

    expect(screen.getByRole('heading', { level: 1, name: '项目总结' })).toBeInTheDocument();
    expect(screen.getByText('核心能力').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('**核心能力**')).not.toBeInTheDocument();
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(screen.getByText('<script>MACHINE_ONLY_HTML</script>')).toBeInTheDocument();
  });

  it('hides provider identifiers and session history but keeps new chat available in simple mode', async () => {
    useAppStore.setState({
      providerConfigs: [
        {
          id: 'siliconflow',
          kind: 'silicon_flow',
          endpoint: 'https://example.invalid/v1',
          model: 'private-model-id',
          temperature: 0.2,
          proxyUrl: null,
          configured: true,
          active: true,
        },
      ],
      activeProviderId: 'siliconflow',
      runtimeMode: 'web-mock',
    });

    render(
      <I18nProvider>
        <ChatPanel professionalTools={false} />
      </I18nProvider>
    );

    expect(screen.getByText('AI 已就绪')).toBeInTheDocument();
    expect(screen.queryByText(/siliconflow/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/private-model-id/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('新建会话')).not.toBeInTheDocument();

    const previousSessionId = useAppStore.getState().activeSessionId;
    fireEvent.click(screen.getByRole('button', { name: '新对话' }));
    await waitFor(() => expect(useAppStore.getState().activeSessionId).not.toBe(previousSessionId));
    expect(useAppStore.getState().sessions).toHaveLength(2);
    expect(useAppStore.getState().sessions[1].messages).toEqual([]);
  });

  it('opens the send manifest proactively for the first user message only', () => {
    useAppStore.setState({
      sessions: [{ id: 'session', title: 'New chat', messages: [] }],
      chatRequestId: null,
    });

    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('描述你希望对当前文件做出的修改…'), {
      target: { value: 'Summarize this document' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送$/ }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('prepares later manifests in the background without reopening the dialog', async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      sessions: [
        {
          id: 'session',
          title: 'Existing chat',
          messages: [
            { id: 'user-1', role: 'user', content: 'First request', status: 'complete' },
            { id: 'assistant-1', role: 'assistant', content: 'First answer', status: 'complete' },
          ],
        },
      ],
      chatRequestId: null,
      sendChat,
    });

    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('描述你希望对当前文件做出的修改…'), {
      target: { value: 'Continue with the same context' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送$/ }));

    await waitFor(() =>
      expect(sendChat).toHaveBeenCalledWith('Continue with the same context', expect.any(String))
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /修改发送清单$/ })).toBeVisible();
  });

  it('shows a provider change across route remounts for a pre-existing session without a baseline', () => {
    const cloudProvider = {
      id: 'cloud',
      kind: 'custom' as const,
      endpoint: 'https://api.example.invalid/v1',
      model: 'cloud-model',
      temperature: 0.2,
      proxyUrl: null,
      configured: true,
      active: true,
    };
    useAppStore.setState({
      sessions: [
        {
          id: 'session',
          title: 'Existing chat',
          messages: [{ id: 'user-1', role: 'user', content: 'First request', status: 'complete' }],
        },
      ],
      providerConfigs: [cloudProvider],
      activeProviderId: 'cloud',
      chatRequestId: null,
    });

    const firstRender = render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );
    firstRender.unmount();

    useAppStore.setState({
      providerConfigs: [
        { ...cloudProvider, active: false },
        {
          ...cloudProvider,
          id: 'local',
          endpoint: 'http://localhost:11434/v1',
          model: 'local-model',
          active: true,
        },
      ],
      activeProviderId: 'local',
      contextReviewKeyBySession: { session: 'provider-configuration-changed' },
    });
    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );

    expect(screen.getByText('本机处理')).toBeVisible();
    expect(screen.getByText('发送范围有变化')).toBeVisible();
  });

  it('prompts the user to edit a changed send scope without opening the dialog', async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      sessions: [
        {
          id: 'session',
          title: 'Existing chat',
          messages: [{ id: 'user-1', role: 'user', content: 'First request', status: 'complete' }],
        },
      ],
      activePath: 'notes/first.md',
      files: [
        { path: 'notes/first.md', name: 'first.md', language: 'md', content: 'First' },
        { path: 'notes/second.md', name: 'second.md', language: 'md', content: 'Second' },
      ],
      chatRequestId: null,
      sendChat,
    });

    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );
    await waitFor(() => expect(screen.getByText('本会话已沿用')).toBeVisible());

    fireEvent.change(screen.getByPlaceholderText('描述你希望对当前文件做出的修改…'), {
      target: { value: 'Continue with the original file' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送$/ }));
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));
    sendChat.mockClear();

    act(() => useAppStore.setState({ activePath: 'notes/second.md' }));
    await waitFor(() => expect(screen.getByText('发送范围有变化')).toBeVisible());
    fireEvent.change(screen.getByPlaceholderText('描述你希望对当前文件做出的修改…'), {
      target: { value: 'Use the second file' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送$/ }));

    expect(sendChat).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText(/请点击“修改发送清单”检查并保存后再发送/)).toBeVisible();
  });

  it('never auto-confirms a sensitive manifest discovered during a later send', async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    const confirmContext = vi
      .spyOn(chatController, 'confirmContext')
      .mockImplementation(async () => {
        throw new Error('sensitive manifests must not be auto-confirmed');
      });
    vi.spyOn(chatController, 'planContext').mockResolvedValue({
      id: 'sensitive-manifest',
      workspaceId: 'workspace',
      sessionId: 'session',
      providerId: 'cloud',
      processingLocation: 'cloud',
      ...plannerFields,
      status: 'awaiting_confirmation',
      includedSources: [],
      excludedSources: [],
      characterCount: 0,
      estimatedTokens: 10,
      sensitiveWarning: true,
      requiresSensitiveConfirmation: true,
      createdAt: '1',
      expiresAt: '2',
      confirmedAt: null,
    });
    useAppStore.setState({
      runtimeMode: 'desktop',
      sessions: [
        {
          id: 'session',
          title: 'Existing chat',
          messages: [{ id: 'user-1', role: 'user', content: 'First request', status: 'complete' }],
        },
      ],
      activeProviderId: 'cloud',
      chatRequestId: null,
      sendChat,
    });

    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );
    fireEvent.change(screen.getByPlaceholderText('描述你希望对当前文件做出的修改…'), {
      target: { value: 'Continue safely' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送$/ }));

    expect(await screen.findByText(/本次清单包含可能的敏感信息/)).toBeVisible();
    expect(confirmContext).not.toHaveBeenCalled();
    expect(sendChat).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /修改发送清单$/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认并发送' })).toBeDisabled();
  });

  it('discards a background manifest when the prompt changes before confirmation', async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    const confirmContext = vi.spyOn(chatController, 'confirmContext').mockResolvedValue({
      id: 'fresh-manifest',
      workspaceId: 'workspace',
      sessionId: 'session',
      providerId: 'cloud',
      processingLocation: 'cloud',
      ...plannerFields,
      status: 'confirmed',
      includedSources: [],
      excludedSources: [],
      characterCount: 0,
      estimatedTokens: 10,
      sensitiveWarning: false,
      requiresSensitiveConfirmation: false,
      createdAt: '1',
      expiresAt: '2',
      confirmedAt: '1',
    });
    vi.spyOn(chatController, 'planContext')
      .mockResolvedValueOnce({
        id: 'stale-sensitive-manifest',
        workspaceId: 'workspace',
        sessionId: 'session',
        providerId: 'cloud',
        processingLocation: 'cloud',
        ...plannerFields,
        status: 'awaiting_confirmation',
        includedSources: [],
        excludedSources: [],
        characterCount: 0,
        estimatedTokens: 10,
        sensitiveWarning: true,
        requiresSensitiveConfirmation: true,
        createdAt: '1',
        expiresAt: '2',
        confirmedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'fresh-manifest',
        workspaceId: 'workspace',
        sessionId: 'session',
        providerId: 'cloud',
        processingLocation: 'cloud',
        ...plannerFields,
        status: 'awaiting_confirmation',
        includedSources: [],
        excludedSources: [],
        characterCount: 0,
        estimatedTokens: 10,
        sensitiveWarning: false,
        requiresSensitiveConfirmation: false,
        createdAt: '1',
        expiresAt: '2',
        confirmedAt: null,
      });
    useAppStore.setState({
      runtimeMode: 'desktop',
      sessions: [
        {
          id: 'session',
          title: 'Existing chat',
          messages: [{ id: 'user-1', role: 'user', content: 'First request', status: 'complete' }],
        },
      ],
      activeProviderId: 'cloud',
      chatRequestId: null,
      sendChat,
    });

    render(
      <I18nProvider>
        <ChatPanel />
      </I18nProvider>
    );
    const input = screen.getByPlaceholderText('描述你希望对当前文件做出的修改…');
    fireEvent.change(input, { target: { value: 'Original prompt' } });
    fireEvent.click(screen.getByRole('button', { name: /发送$/ }));
    expect(await screen.findByText(/本次清单包含可能的敏感信息/)).toBeVisible();

    fireEvent.change(input, { target: { value: 'Changed prompt' } });
    fireEvent.click(screen.getByRole('button', { name: /发送$/ }));

    await waitFor(() => expect(sendChat).toHaveBeenCalledWith('Changed prompt', 'fresh-manifest'));
    expect(confirmContext).toHaveBeenCalledWith('fresh-manifest', false);
    expect(confirmContext).not.toHaveBeenCalledWith('stale-sensitive-manifest', expect.anything());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
