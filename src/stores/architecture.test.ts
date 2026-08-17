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

  it('organizes the S1.4 home around Result and Task controllers rather than chat sessions', () => {
    const homePage = sources['../features/home/components/HomePage.tsx'];
    const homeStore = sources['../features/home/homeStore.ts'];
    const homeController = sources['../features/home/homeController.ts'];

    expect(homePage).toContain('useHomeStore');
    expect(homePage).toContain('recentResults');
    expect(homePage).not.toContain('sessions');
    expect(homePage).not.toContain('sendChat');
    expect(homeStore).toContain('homeController.createTask');
    expect(homeStore).toContain('homeController.answerTask');
    expect(homeStore).toContain('homeController.startTask');
    expect(homeStore).not.toContain('platform/gateway');
    expect(homeController).toContain('shared/platform/gateway');
  });

  it('keeps the S1.5 Result workbench behind its controller and separate from chat state', () => {
    const resultStore = sources['../features/results/resultStore.ts'];
    const resultController = sources['../features/results/resultController.ts'];
    const resultWorkbench = sources['../features/results/components/ResultWorkbench.tsx'];
    const resultAssistant = sources['../features/results/components/ResultAssistantPanel.tsx'];

    expect(resultStore).toContain('resultController.create');
    expect(resultStore).toContain('resultController.open');
    expect(resultStore).toContain('resultController.save');
    expect(resultStore).not.toContain('platform/gateway');
    expect(resultStore).not.toContain('sessions');
    expect(resultController).toContain('shared/platform/gateway');
    expect(resultWorkbench).toContain('useResultStore');
    expect(resultWorkbench).not.toContain('desktopApi');
    expect(resultAssistant).toContain('resultAssistantContextNotice');
  });

  it('keeps the S2.1 ImportBatch trust boundary behind a controller and explicit confirmation', () => {
    const importStore = sources['../features/imports/importStore.ts'];
    const importController = sources['../features/imports/importController.ts'];
    const importModal = sources['../features/imports/components/ImportBatchModal.tsx'];

    expect(importStore).toContain('importController.select');
    expect(importStore).toContain('importController.confirm');
    expect(importStore).toContain('importController.cancel');
    expect(importStore).toContain('importController.selectBrowserDropFallback');
    expect(importStore).not.toContain('platform/gateway');
    expect(importController).toContain('shared/platform/gateway');
    expect(importController).toContain('setDropTarget');
    expect(importController).toContain('listenForDrops');
    expect(importModal).toContain('acceptedItemIds');
    expect(importModal).not.toContain('desktopApi');
  });
});
