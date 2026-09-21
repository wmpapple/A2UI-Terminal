import type { ResultSummary } from './domain';

export function compareResults(left: ResultSummary, right: ResultSummary): number {
  const pinOrder = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
  if (pinOrder) return pinOrder;
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? -1 : 1;
  return left.id === right.id ? 0 : left.id > right.id ? -1 : 1;
}
