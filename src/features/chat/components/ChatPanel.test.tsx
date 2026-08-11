import { render, screen } from '@testing-library/react';
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
});
