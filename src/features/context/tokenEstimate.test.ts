import { describe, expect, it } from 'vitest';
import { estimateContextTokens } from './tokenEstimate';

describe('estimateContextTokens', () => {
  it('matches the conservative Rust planner estimate', () => {
    expect(estimateContextTokens('中'.repeat(100))).toBe(200);
    expect(estimateContextTokens('a'.repeat(400))).toBe(100);
  });
});
