import { describe, expect, it } from 'vitest';
import { basicCatalog, isBasicComponent } from './basicCatalog';

describe('Basic Catalog allowlist', () => {
  it('accepts registered components and rejects executable content', () => {
    expect(isBasicComponent('Card')).toBe(true);
    expect(isBasicComponent('Script')).toBe(false);
    expect(isBasicComponent('iframe')).toBe(false);
  });

  it('contains exactly the approved first 13 components', () => {
    expect(new Set(basicCatalog).size).toBe(13);
  });
});
