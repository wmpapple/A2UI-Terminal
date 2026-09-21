import type { ChatSession } from '../../shared/types/domain';

const groupKeys = [
  'historyToday',
  'historyYesterday',
  'historyWeek',
  'historyOlder',
  'historyUndated',
] as const;

export function groupChatHistory(sessions: ChatSession[], now = new Date()) {
  const calendarDay = (date: Date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  const today = calendarDay(now);
  const entries = sessions.map((session) => {
    const timestamp = [session.updatedAt, session.messages.at(-1)?.createdAt, session.createdAt]
      .map((value) => (value ? Date.parse(value) : NaN))
      .find(Number.isFinite);
    const date = timestamp === undefined ? null : new Date(timestamp);
    const age = date ? today - calendarDay(date) : null;
    const group =
      age === null || age < 0
        ? 'historyUndated'
        : age === 0
          ? 'historyToday'
          : age === 1
            ? 'historyYesterday'
            : age < 7
              ? 'historyWeek'
              : 'historyOlder';
    return { session, date, group };
  });
  entries.sort((a, b) => (b.date?.getTime() ?? -Infinity) - (a.date?.getTime() ?? -Infinity));
  return groupKeys.map((key) => ({ key, entries: entries.filter((entry) => entry.group === key) }));
}
