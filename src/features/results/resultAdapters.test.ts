import { describe, expect, it } from 'vitest';
import {
  defaultFormatForResultType,
  parseChecklist,
  parseCsv,
  serializeChecklist,
  serializeCsv,
  suggestedResultFileName,
} from './resultAdapters';

describe('result adapters', () => {
  it('maps all Result types to a canonical internal format', () => {
    expect(defaultFormatForResultType('document')).toBe('markdown');
    expect(defaultFormatForResultType('spreadsheet')).toBe('csv');
    expect(defaultFormatForResultType('checklist')).toBe('json');
    expect(defaultFormatForResultType('form')).toBe('json');
    expect(defaultFormatForResultType('tool')).toBe('json');
  });

  it('round trips quoted CSV cells', () => {
    const rows = [
      ['name', 'note'],
      ['A, B', 'said "hello"'],
    ];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
  });

  it('round trips checklist JSON and produces a safe suggested file name', () => {
    const items = [{ id: 'one', text: '第一项', completed: false }];
    expect(parseChecklist(serializeChecklist(items))).toEqual(items);
    expect(suggestedResultFileName('季度/计划', 'checklist')).toBe('季度-计划.json');
  });
});
