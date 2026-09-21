import { describe, expect, it } from 'vitest';
import type { ChatSession } from '../../../shared/types/domain';
import { groupChatHistory } from '../chatHistoryTimeline';

const session = (id: string, updatedAt?: string): ChatSession => ({
  id,
  title: id,
  messages: [],
  updatedAt,
});

describe('chat history timeline', () => {
  it('groups by local calendar days and orders newest conversations first', () => {
    const now = new Date(2026, 8, 20, 12);
    const date = (day: number, hour = 12) => new Date(2026, 8, day, hour).toISOString();
    const groups = groupChatHistory(
      [
        session('older', date(13)),
        session('week', date(14)),
        session('yesterday', date(19)),
        session('morning', date(20, 8)),
        session('recent', date(20, 11)),
        session('unknown'),
        session('invalid', 'invalid'),
      ],
      now
    );
    expect(
      groups.map(({ key, entries }) => [key, entries.map(({ session }) => session.id)])
    ).toEqual([
      ['historyToday', ['recent', 'morning']],
      ['historyYesterday', ['yesterday']],
      ['historyWeek', ['week']],
      ['historyOlder', ['older']],
      ['historyUndated', ['unknown', 'invalid']],
    ]);
  });

  it('falls back to real message or creation timestamps instead of inventing dates', () => {
    const item = session('fallback', 'invalid');
    item.createdAt = new Date(2026, 8, 1).toISOString();
    item.messages = [
      {
        id: 'm',
        role: 'user',
        content: 'Hello',
        createdAt: new Date(2026, 8, 19, 23).toISOString(),
      },
    ];
    const groups = groupChatHistory([item], new Date(2026, 8, 20, 1));
    expect(groups.find(({ key }) => key === 'historyYesterday')?.entries[0].session.id).toBe(
      'fallback'
    );
  });
});
