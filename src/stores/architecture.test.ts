import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../**/*.{ts,tsx}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const productionSources = Object.entries(sources).filter(([path]) => !path.includes('.test.'));

describe('front-end application boundaries', () => {
  it('keeps the low-level Desktop API behind the shared gateway', () => {
    const offenders = productionSources
      .filter(([path]) => !path.endsWith('/shared/platform/gateway.ts'))
      .filter(([path]) => !path.endsWith('/shared/platform/desktop.ts'))
      .filter(([, source]) => source.includes('shared/platform/desktop'))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it('keeps React components away from Desktop API and gateway imports', () => {
    const offenders = productionSources
      .filter(([path]) => path.endsWith('.tsx'))
      .filter(([, source]) => /shared\/platform\/(desktop|gateway)/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it('routes feature stores through controllers instead of the gateway', () => {
    const offenders = productionSources
      .filter(([path]) => path.endsWith('Store.ts'))
      .filter(([, source]) => source.includes('shared/platform/gateway'))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it('keeps useAppStore as a small composition root', () => {
    const source = sources['./useAppStore.ts'];
    expect(source.split(/\r?\n/).length).toBeLessThan(100);
    expect(source).toContain('...createWorkspaceStore(set, get)');
    expect(source).toContain('...createProviderStore(set, get)');
    expect(source).toContain('...createChatStore(set, get)');
    expect(source).toContain('...createReviewStore(set, get)');
    expect(source).toContain('...createA2uiStore(set, get)');
    expect(source).not.toContain('desktopGateway');
  });
});
