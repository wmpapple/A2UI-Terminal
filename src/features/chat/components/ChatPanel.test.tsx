import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useAppStore } from '../../../stores/useAppStore';
import { ChatPanel } from './ChatPanel';

const rawProtocol = '{"version":"1.0","type":"document_patch","changes":["MACHINE_ONLY_PROTOCOL"]';

beforeEach(() => {
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
});
