import { describe, expect, it } from 'vitest';
import { normalizeGeneratedText } from './text';

describe('normalizeGeneratedText', () => {
  it('normalizes escaped newlines and quotes', () => {
    expect(normalizeGeneratedText('title\\\\nbody\\"quoted\\"')).toBe('title\nbody"quoted"');
  });

  it('rejects non-string input', () => {
    expect(normalizeGeneratedText(null)).toBe('');
  });
});
