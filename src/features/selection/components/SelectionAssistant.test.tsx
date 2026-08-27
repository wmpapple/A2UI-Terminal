import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useAppStore } from '../../../stores/useAppStore';
import { SelectionAssistant } from './SelectionAssistant';

describe('SelectionAssistant', () => {
  beforeEach(() => {
    useAppStore.setState({
      runtimeMode: 'web-mock',
      workspace: { id: 'workspace', name: 'Workspace', available: true, kind: 'directory' },
      files: [
        {
          path: 'notes.md',
          name: 'notes.md',
          language: 'markdown',
          content: '需要润色的段落',
          contentHash: 'hash',
          editable: true,
        },
      ],
      activePath: 'notes.md',
      selectedText: '需要润色的段落',
      sessions: [{ id: 'session', title: 'Chat', messages: [] }],
      activeSessionId: 'session',
      activeProviderId: 'local',
      providerConfigs: [
        {
          id: 'local',
          kind: 'custom',
          endpoint: 'http://localhost:11434/v1',
          model: 'local',
          temperature: 0.2,
          proxyUrl: null,
          configured: true,
          active: true,
        },
      ],
      chatRequestId: null,
    });
  });

  it('does not render without a non-empty selection', () => {
    useAppStore.setState({ selectedText: '' });
    render(
      <I18nProvider>
        <SelectionAssistant />
      </I18nProvider>
    );
    expect(screen.queryByLabelText('选区助手')).not.toBeInTheDocument();
  });

  it('confirms a modifying action and marks its review source as selection', async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ sendChat });
    render(
      <I18nProvider>
        <SelectionAssistant />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /润\s*色/ }));
    expect(
      await screen.findByText('修改将先生成审阅方案；接受前不会写入编辑器或文件。')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生成审阅方案' }));

    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));
    expect(sendChat.mock.calls[0][2]).toBe('selection');
    expect(sendChat.mock.calls[0][3]).toBe(false);
  });

  it('marks explanation as read-only', async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ sendChat });
    render(
      <I18nProvider>
        <SelectionAssistant />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /解\s*释/ }));
    fireEvent.click(await screen.findByRole('button', { name: '生成解释' }));
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));
    expect(sendChat.mock.calls[0][2]).toBe('selection');
    expect(sendChat.mock.calls[0][3]).toBe(true);
  });
});
