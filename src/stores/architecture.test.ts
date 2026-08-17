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

  it('keeps simple and professional modes as one presentation shell over shared business state', () => {
    const shell = sources['../app/AppShell.tsx'];
    const preferences = sources['../app/shellPreferences.ts'];

    expect(shell.match(/<WorkspaceLayout/g)).toHaveLength(1);
    expect(shell.match(/<WorkspaceSidebar/g)).toHaveLength(1);
    expect(shell.match(/<EditorPane/g)).toHaveLength(1);
    expect(shell.match(/<ChatPanel/g)).toHaveLength(1);
    expect(shell).toContain('showLeftPanel={professional}');
    expect(shell).toContain('showInspector={professional}');
    expect(shell).toContain('showSimpleFileActions={!professional}');
    expect(shell).toContain('professionalTools={professional}');
    expect(shell).toContain('open={professional && settingsOpen}');
    expect(sources['../features/settings/components/ProviderSettings.tsx']).toContain(
      '<Form.Item label="Endpoint" required>'
    );
    expect(sources['../features/settings/components/ProviderSettings.tsx']).toContain(
      '<Form.Item label="API Key"'
    );
    expect(preferences).not.toContain('useAppStore');
    expect(preferences).not.toContain('platform/gateway');
    expect(preferences).not.toContain('platform/desktop');
  });
});
