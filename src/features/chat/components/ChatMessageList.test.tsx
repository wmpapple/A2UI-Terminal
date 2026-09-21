import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { ChatMessage } from '../../../shared/types/domain';
import { ChatMessageList } from './ChatMessageList';

const messages: ChatMessage[] = Array.from({ length: 2000 }, (_, index) => ({
  id: String(index),
  role: 'user',
  content: `Message ${index}`,
  status: 'complete',
}));
const props = {
  requestActive: false,
  reviewAvailable: false,
  onOpenReview: vi.fn(),
  onOpenSurface: vi.fn(),
  onRetry: vi.fn(),
};
const view = (items: ChatMessage[]) => (
  <I18nProvider>
    <ChatMessageList {...props} messages={items} />
  </I18nProvider>
);

describe('bounded chat history', () => {
  it('resumes following when scrolling back to the bottom of the newest window', () => {
    const { rerender } = render(view(messages));
    const log = screen.getByRole('log');
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 3000 },
      clientHeight: { configurable: true, value: 400 },
    });
    log.scrollTop = 600;
    fireEvent.scroll(log);
    expect(screen.getByRole('button', { name: '回到最新消息' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '查看较新消息' })).not.toBeInTheDocument();
    log.scrollTop = 2600;
    fireEvent.scroll(log);
    expect(screen.queryByRole('button', { name: '回到最新消息' })).not.toBeInTheDocument();
    expect(log).toHaveAttribute('aria-live', 'polite');
    rerender(
      view([
        ...messages,
        { id: 'latest', role: 'assistant', content: 'Latest reply', status: 'streaming' },
      ])
    );
    expect(screen.getByText('Latest reply')).toBeVisible();
    expect(log.scrollTop).toBe(3000);
  });

  it('does not treat the bottom of an older page as the latest message', () => {
    render(view(messages));
    fireEvent.click(screen.getByRole('button', { name: '查看更早消息' }));
    const log = screen.getByRole('log');
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 3000 },
      clientHeight: { configurable: true, value: 400 },
    });
    log.scrollTop = 2600;
    fireEvent.scroll(log);
    expect(screen.getByRole('button', { name: '回到最新消息' })).toBeVisible();
    expect(screen.queryByText('Message 1999')).not.toBeInTheDocument();
    expect(log).toHaveAttribute('aria-live', 'off');
  });

  it('limits DOM nodes, reaches older history and preserves retry indexes', () => {
    const items = messages.map((item, index) =>
      index === 1939 ? { ...item, status: 'error' as const } : item
    );
    render(view(items));
    expect(screen.getAllByRole('article')).toHaveLength(60);
    expect(screen.getByText('Message 1999')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '查看更早消息' }));
    expect(screen.getAllByRole('article')).toHaveLength(60);
    expect(screen.getByText('Message 1939')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /重试$/ }));
    expect(props.onRetry).toHaveBeenCalledWith(1939);
    fireEvent.click(screen.getByRole('button', { name: '回到最新消息' }));
    expect(screen.getByText('Message 1999')).toBeVisible();
  });
  it('keeps the reading position and history window when a new message arrives', () => {
    const { rerender } = render(view(messages));
    const log = screen.getByRole('log');
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 3000 },
      clientHeight: { configurable: true, value: 400 },
    });
    log.scrollTop = 600;
    fireEvent.scroll(log);
    rerender(
      view([
        ...messages,
        { id: 'new', role: 'assistant', content: 'New response', status: 'streaming' },
      ])
    );
    expect(log.scrollTop).toBe(600);
    expect(screen.getByText('Message 1940')).toBeVisible();
    expect(screen.queryByText('New response')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '回到最新消息' }));
    expect(screen.getByText('New response')).toBeVisible();
    expect(log.scrollTop).toBe(3000);
  });
});
