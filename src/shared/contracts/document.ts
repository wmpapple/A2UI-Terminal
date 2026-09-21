import type {
  DocumentSnapshot,
  DocumentTarget,
  ParsedDocument,
  SelectionSnapshot,
} from '../types/document';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const offset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const isDocumentTarget = (value: unknown): value is DocumentTarget => {
  if (!record(value)) return false;
  if (value.kind === 'result') return keys(value, ['kind', 'resultId']) && id(value.resultId);
  return (
    value.kind === 'workspace_file' &&
    keys(value, ['kind', 'workspaceId', 'sourceId']) &&
    id(value.workspaceId) &&
    id(value.sourceId)
  );
};

export const isDocumentSnapshot = (value: unknown): value is DocumentSnapshot =>
  record(value) &&
  isDocumentTarget(value.target) &&
  (value.revisionId === null || id(value.revisionId)) &&
  hash(value.contentHash) &&
  typeof value.format === 'string' &&
  typeof value.text === 'string' &&
  typeof value.editable === 'boolean' &&
  typeof value.hasUnsavedDraft === 'boolean';

export const isSelectionSnapshot = (value: unknown): value is SelectionSnapshot =>
  record(value) &&
  keys(value, [
    'target',
    'revisionId',
    'contentHash',
    'start',
    'end',
    'offsetUnit',
    'selectedTextHash',
  ]) &&
  isDocumentTarget(value.target) &&
  (value.revisionId === null || id(value.revisionId)) &&
  hash(value.contentHash) &&
  offset(value.start) &&
  offset(value.end) &&
  value.end > value.start &&
  value.offsetUnit === 'utf16' &&
  hash(value.selectedTextHash);

export const isParsedDocument = (value: unknown): value is ParsedDocument =>
  record(value) &&
  typeof value.format === 'string' &&
  typeof value.parserVersion === 'string' &&
  hash(value.rawHash) &&
  hash(value.extractedHash) &&
  Array.isArray(value.warnings) &&
  value.warnings.every((item) => typeof item === 'string') &&
  Array.isArray(value.blocks) &&
  value.blocks.every((block) => {
    if (
      !record(block) ||
      typeof block.id !== 'string' ||
      typeof block.text !== 'string' ||
      !record(block.locator)
    )
      return false;
    const locator = block.locator;
    return locator.kind === 'unavailable'
      ? typeof locator.reason === 'string'
      : locator.kind === 'text_range' &&
          offset(locator.start) &&
          offset(locator.end) &&
          locator.end >= locator.start &&
          locator.offsetUnit === 'utf16';
  });
