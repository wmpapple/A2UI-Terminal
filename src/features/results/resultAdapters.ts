import type { ResultType, TextResultFormat } from '../../shared/types/domain';

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface FormField {
  id: string;
  label: string;
  kind: 'text' | 'number' | 'date' | 'checkbox';
  required: boolean;
}

export interface ToolSetting {
  key: string;
  label: string;
  value: string;
}

export const resultAdapterDefinitions: Record<
  ResultType,
  { format: TextResultFormat; extension: string; labelKey: string }
> = {
  document: { format: 'markdown', extension: 'md', labelKey: 'resultTypeDocument' },
  spreadsheet: { format: 'csv', extension: 'csv', labelKey: 'resultTypeSpreadsheet' },
  checklist: { format: 'json', extension: 'json', labelKey: 'resultTypeChecklist' },
  form: { format: 'json', extension: 'json', labelKey: 'resultTypeForm' },
  tool: { format: 'json', extension: 'json', labelKey: 'resultTypeTool' },
};

export const defaultFormatForResultType = (type: ResultType): TextResultFormat =>
  resultAdapterDefinitions[type].format;

export const suggestedResultFileName = (title: string, type: ResultType): string => {
  const safeTitle = title
    .trim()
    .replace(/[\\/:<>"|?*]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  return safeTitle ? `${safeTitle}.${resultAdapterDefinitions[type].extension}` : '';
};

const parseObjectArray = <T>(content: string, key: string): T[] => {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
  const items = (value as Record<string, unknown>)[key];
  if (!Array.isArray(items)) throw new Error('invalid');
  return items as T[];
};

export const parseChecklist = (content: string): ChecklistItem[] =>
  parseObjectArray<ChecklistItem>(content, 'items');

export const serializeChecklist = (items: ChecklistItem[]): string =>
  JSON.stringify({ items }, null, 2);

export const parseForm = (content: string): FormField[] =>
  parseObjectArray<FormField>(content, 'fields');

export const serializeForm = (fields: FormField[]): string => JSON.stringify({ fields }, null, 2);

export const parseTool = (content: string): ToolSetting[] =>
  parseObjectArray<ToolSetting>(content, 'settings');

export const serializeTool = (settings: ToolSetting[]): string =>
  JSON.stringify({ settings }, null, 2);

export const parseCsv = (content: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || row.length || !rows.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

const csvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export const serializeCsv = (rows: string[][]): string =>
  `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
