import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import { desktopApi } from '../../shared/platform/desktop';
import { useAppStore } from '../../stores/useAppStore';
import { ChatHistoryDrawer } from './components/ChatHistoryDrawer';

const sessions = [
  {
    id: 'one',
    title: 'First',
    messages: [
      {
        id: 'm',
        role: 'user' as const,
        content: 'Needle in message',
        createdAt: '2026-09-20T01:00:00Z',
      },
    ],
  },
  { id: 'two', title: 'Pinned', messages: [], pinned: true },
];

describe('history management', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      runtimeMode: 'desktop',
      workspace: { id: 'w', name: 'w', kind: 'directory', available: true },
      sessions,
      activeSessionId: 'one',
      chatRequestId: null,
      chatError: null,
    });
  });
  it('searches message contents and requires confirmation before deleting', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    render(
      <I18nProvider>
        <ChatHistoryDrawer
          open
          sessions={sessions}
          activeSessionId="one"
          onClose={vi.fn()}
          onSelect={vi.fn()}
          onDelete={remove}
          onPin={vi.fn()}
        />
      </I18nProvider>
    );
    expect(
      within(screen.getByRole('region', { name: '置顶对话' })).getByText('Pinned')
    ).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: '查找标题或对话内容' }), {
      target: { value: 'NEEDLE' },
    });
    expect(screen.getByText('First')).toBeVisible();
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除对话: First' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('one'));
  });
  it('persists pinning and cleans deleted active conversation state', async () => {
    const pin = vi.spyOn(desktopApi, 'pinChatSession').mockResolvedValue(undefined);
    vi.spyOn(desktopApi, 'deleteChatSession').mockResolvedValue(undefined);
    useAppStore.setState({
      chatDrafts: { '["w","one"]': 'draft' },
      contextReviewKeyBySession: { one: 'review' },
    });
    await useAppStore.getState().pinSession('one', true);
    expect(pin).toHaveBeenCalledWith('w', 'one', true);
    expect(useAppStore.getState().sessions[0].pinned).toBe(true);
    await useAppStore.getState().deleteSession('one');
    expect(useAppStore.getState().activeSessionId).toBe('two');
    expect(useAppStore.getState().chatDrafts).toEqual({});
    expect(useAppStore.getState().contextReviewKeyBySession).toEqual({});
  });
  it('retains a conversation on failure and blocks deletion during streaming', async () => {
    const remove = vi
      .spyOn(desktopApi, 'deleteChatSession')
      .mockRejectedValue(new Error('offline'));
    await useAppStore.getState().deleteSession('one');
    expect(useAppStore.getState().sessions).toHaveLength(2);
    remove.mockClear();
    useAppStore.setState({ chatRequestId: 'stream' });
    await useAppStore.getState().deleteSession('one');
    expect(remove).not.toHaveBeenCalled();
  });
  it('creates a new conversation after removing the last one', async () => {
    vi.spyOn(desktopApi, 'deleteChatSession').mockResolvedValue(undefined);
    vi.spyOn(desktopApi, 'createChatSession').mockImplementation(
      async (_workspaceId, id, title) => ({ id, title, messages: [] })
    );
    useAppStore.setState({ sessions: [sessions[0]] });
    await useAppStore.getState().deleteSession('one');
    expect(useAppStore.getState().sessions).toHaveLength(1);
    expect(useAppStore.getState().activeSessionId).not.toBe('one');
  });
});
