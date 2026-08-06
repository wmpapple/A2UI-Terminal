import { describe, expect, it } from 'vitest';
import { isBasicComponent } from './basicCatalog';

describe('Basic Catalog allowlist', () => {
  it('accepts registered components and rejects executable content', () => {
    expect(isBasicComponent('Card')).toBe(true);
    expect(isBasicComponent('Script')).toBe(false);
    expect(isBasicComponent('iframe')).toBe(false);
  });
});
