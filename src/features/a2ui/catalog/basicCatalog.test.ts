import { describe, expect, it } from 'vitest';
import { basicCatalog, isBasicComponent } from './basicCatalog';

describe('Basic Catalog allowlist', () => {
  it('accepts registered components and rejects executable content', () => {
    expect(isBasicComponent('Card')).toBe(true);
    expect(isBasicComponent('Script')).toBe(false);
    expect(isBasicComponent('iframe')).toBe(false);
  });

  it('contains exactly the approved 13 base and 6 S3.2 components', () => {
    expect(new Set(basicCatalog).size).toBe(19);
    expect(basicCatalog).toEqual(
      expect.arrayContaining(['Checklist', 'Owner', 'Date', 'Status', 'Table', 'IssueCard'])
    );
  });
});
