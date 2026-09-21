import {
  AppstoreOutlined,
  FileDoneOutlined,
  GlobalOutlined,
  DownOutlined,
  SearchOutlined,
  HomeOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { Alert, Button, ConfigProvider, Dropdown, message, Tag, theme } from 'antd';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { HomePage } from '../features/home/components/HomePage';
import { ImportBatchModal } from '../features/imports/components/ImportBatchModal';
import { useImportStore } from '../features/imports/importStore';
import { OnboardingDialog } from '../features/home/components/OnboardingDialog';
import { scheduleAutomaticUpdateCheck } from '../features/settings/appUpdater';

import { getRuntimeMode } from '../shared/platform/runtime';
import {
  finishPerformanceMeasurement,
  startPerformanceMeasurement,
} from '../shared/performance/performanceBudget';
import type { ResultAppliedReview } from '../shared/types/domain';
import { useAppStore } from '../stores/useAppStore';
import { useI18n } from './i18n/useI18n';
import styles from './AppShell.module.css';

import { ShellPage } from './ShellPage';
import { readOnboardingComplete, writeOnboardingComplete } from './onboardingPreferences';
import {
  navigateTo,
  readExperienceMode,
  routeFromHash,
  writeExperienceMode,
  type AppRoute,
  type ExperienceMode,
} from './shellPreferences';
import { useReducedMotion, useSystemTheme } from './useSystemTheme';
import { WorkspaceLayout } from './WorkspaceLayout';
import { WorkbenchAppearance } from './WorkbenchAppearance';

import { lazyFeature } from './lazyFeature';
const CommandPalette = lazyFeature(async () => {
  const module = await import('./CommandPalette');
  return { default: module.CommandPalette };
});
const CreateTextResultModal = lazyFeature(async () => {
  const module = await import('../features/results/components/CreateTextResultModal');
  return { default: module.CreateTextResultModal };
});
const ChatPanel = lazyFeature(async () => {
  const module = await import('../features/chat/components/ChatPanel');
  return { default: module.ChatPanel };
});
const ProviderSettings = lazyFeature(async () => {
  const module = await import('../features/settings/components/ProviderSettings');
  return { default: module.ProviderSettings };
});
const ResultsPage = lazyFeature(async () => {
  const module = await import('../features/results/components/ResultsPage');
  return { default: module.ResultsPage };
});
const PersonalSurfaceTemplates = lazyFeature(async () => {
  const module = await import('../features/templates/components/PersonalSurfaceTemplates');
  return { default: module.PersonalSurfaceTemplates };
});
const ResultAssistantPanel = lazyFeature(async () => {
  const module = await import('../features/results/components/ResultAssistantPanel');
  return { default: module.ResultAssistantPanel };
});
const ResultWorkbench = lazyFeature(async () => {
  const module = await import('../features/results/components/ResultWorkbench');
  return { default: module.ResultWorkbench };
});
const EditorPane = lazyFeature(async () => {
  const module = await import('../features/workspace/components/EditorPane');
  return { default: module.EditorPane };
});
const WorkspaceSidebar = lazyFeature(async () => {
  const module = await import('../features/workspace/components/WorkspaceSidebar');
  return { default: module.WorkspaceSidebar };
});
const SettingsPage = lazyFeature(async () => {
  const module = await import('./SettingsPage');
  return { default: module.SettingsPage };
});

export function AppShell() {
  const dark = useSystemTheme();
  const reducedMotion = useReducedMotion();
  const { locale, setLocale, t } = useI18n();
  const mode = getRuntimeMode();
  const initializeWorkspace = useAppStore((state) => state.initializeWorkspace);
  const initializeProviders = useAppStore((state) => state.initializeProviders);
  const patchApplying = useAppStore((state) => state.patchApplying);
  const patchError = useAppStore((state) => state.patchError);
  const undoLastPatch = useAppStore((state) => state.undoLastPatch);
  const acceptImportedSelection = useAppStore((state) => state.acceptImportedSelection);
  const importError = useImportStore((state) => state.error);
  const clearImportError = useImportStore((state) => state.clearError);
  const [commandOpen, setCommandOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => !readOnboardingComplete());
  const [experienceMode, setExperienceMode] = useState(readExperienceMode);
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [messageApi, messageContextHolder] = message.useMessage();
  const mainContentRef = useRef<HTMLDivElement>(null);
  const initialRouteRef = useRef(true);
  const professional = experienceMode === 'professional';

  useEffect(() => {
    void initializeWorkspace();
    void initializeProviders();
  }, [initializeProviders, initializeWorkspace]);

  useEffect(() => scheduleAutomaticUpdateCheck(), []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'k'
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setCommandOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const syncRoute = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  useEffect(() => {
    if (initialRouteRef.current) {
      initialRouteRef.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      mainContentRef.current?.focus({ preventScroll: true });
      finishPerformanceMeasurement('requestFeedback');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeResultId, route]);

  const changeExperienceMode = (nextMode: ExperienceMode) => {
    writeExperienceMode(nextMode);
    setExperienceMode(nextMode);
    if (nextMode === 'simple') setSettingsOpen(false);
  };

  const openRoute = (nextRoute: AppRoute) => {
    setRoute(nextRoute);
    navigateTo(nextRoute);
  };

  const openWorkbench = (resultId?: string) => {
    setActiveResultId(resultId ?? null);
    openRoute('workbench');
  };

  const openResult = (resultId: string) => {
    startPerformanceMeasurement('requestFeedback');
    startPerformanceMeasurement('resultOpen');
    openWorkbench(resultId);
  };

  const undoCreatedResult = async (review: ResultAppliedReview) => {
    const undone = await undoLastPatch(review);
    if (!undone) {
      void messageApi.error(useAppStore.getState().patchError ?? t('undoReviewUnavailable'));
      return;
    }
    setActiveResultId(null);
    openRoute('results');
    void messageApi.success(t('undoReviewSuccess'));
  };

  const navigationItems: Array<{
    route: AppRoute;
    label: ReturnType<typeof t>;
    icon: ReactNode;
  }> = [
    { route: 'home', label: t('homeNavigation'), icon: <HomeOutlined /> },
    { route: 'results', label: t('resultsNavigation'), icon: <FileDoneOutlined /> },
    { route: 'templates', label: t('templatesNavigation'), icon: <AppstoreOutlined /> },
    { route: 'workbench', label: t('workbenchNavigation'), icon: <ToolOutlined /> },
    { route: 'settings', label: t('settings'), icon: <SettingOutlined /> },
  ];

  const content =
    route === 'home' ? (
      <HomePage onOpenWorkbench={openWorkbench} onOpenGuide={() => setOnboardingOpen(true)} />
    ) : route === 'results' ? (
      <ResultsPage onOpenResult={openResult} />
    ) : route === 'workbench' ? (
      <WorkbenchAppearance>
        <WorkspaceLayout
          showLeftPanel={professional}
          left={<WorkspaceSidebar onActivateWorkspace={() => setActiveResultId(null)} />}
          center={
            activeResultId ? (
              <ResultWorkbench
                key={activeResultId}
                resultId={activeResultId}
                onDuplicated={openResult}
                onOpenResults={() => openRoute('results')}
                reviewUndoing={patchApplying}
                reviewUndoError={patchError}
                onUndoReview={(review) => void undoCreatedResult(review)}
              />
            ) : (
              <EditorPane
                showInspector={professional}
                showSimpleFileActions={!professional}
                onOpenResult={openResult}
              />
            )
          }
          right={
            activeResultId ? (
              <ResultAssistantPanel />
            ) : (
              <ChatPanel professionalTools={professional} />
            )
          }
        />
      </WorkbenchAppearance>
    ) : route === 'templates' ? (
      <PersonalSurfaceTemplates
        onOpened={() => openRoute('workbench')}
        onBrowseTasks={() => openRoute('home')}
      />
    ) : route === 'settings' ? (
      <SettingsPage
        experienceMode={experienceMode}
        onExperienceModeChange={changeExperienceMode}
        onOpenProviderSettings={() => setSettingsOpen(true)}
      />
    ) : (
      <ShellPage route={route} onOpenWorkbench={() => openWorkbench()} />
    );

  const completeOnboarding = () => {
    writeOnboardingComplete();
    setOnboardingOpen(false);
    openRoute('home');
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          motion: !reducedMotion,
          colorPrimary: dark ? '#dba47e' : '#b94b19',
          colorBgLayout: dark ? '#0b0f19' : '#f8fafc',
          colorBgContainer: dark ? '#1e293b' : '#ffffff',
          colorText: dark ? '#e2e8f0' : '#0f172a',
          colorTextSecondary: dark ? '#a8b6cb' : '#64748b',
          colorTextLightSolid: dark ? '#0b0f19' : '#ffffff',
          borderRadius: 10,
          fontFamily: 'Inter, "Segoe UI", sans-serif',
        },
      }}
    >
      {messageContextHolder}
      <div className={styles.app}>
        <a className={styles.skipLink} href="#main-content">
          {t('skipToMainContent')}
        </a>
        <ConfigProvider theme={{ token: { colorPrimary: dark ? '#dba47e' : '#b94b19' } }}>
          <header className={styles.titlebar} data-tauri-drag-region>
            <div className={styles.brand} data-tauri-drag-region>
              <span className={styles.logo}>A</span>
              <strong>{t('appName')}</strong>
              <Tag className={styles.versionTag}>V2.0</Tag>
            </div>
            <nav className={styles.navigation} aria-label={t('mainNavigation')}>
              {navigationItems.map((item) => (
                <Button
                  key={item.route}
                  type="text"
                  aria-label={item.label}
                  icon={item.icon}
                  aria-current={route === item.route ? 'page' : undefined}
                  onClick={() =>
                    item.route === 'workbench' ? openWorkbench() : openRoute(item.route)
                  }
                >
                  {item.label}
                </Button>
              ))}
            </nav>
            <div className={styles.titleActions} role="group" aria-label={t('quickControls')}>
              <Button
                type="text"
                icon={<SearchOutlined />}
                aria-label={t('commandPalette')}
                title={t('commandPalette') + ' (Ctrl/Cmd+K)'}
                onClick={() => setCommandOpen(true)}
              />
              <Dropdown
                trigger={['click']}
                menu={{
                  selectedKeys: [experienceMode],
                  onClick: ({ key }) => changeExperienceMode(key as ExperienceMode),
                  items: [
                    { key: 'simple', label: t('simpleMode') },
                    { key: 'professional', label: t('professionalMode') },
                  ],
                }}
              >
                <Button
                  type="text"
                  aria-label={t('experienceModeTitle')}
                  icon={<DownOutlined />}
                  iconPlacement="end"
                >
                  {t(professional ? 'professionalMode' : 'simpleMode')}
                </Button>
              </Dropdown>
              {professional ? (
                <Tag color={mode === 'web-mock' ? 'blue' : 'green'}>
                  {mode === 'web-mock' ? t('mockMode') : 'Desktop'}
                </Tag>
              ) : null}
              <Dropdown
                trigger={['click']}
                menu={{
                  selectedKeys: [locale],
                  onClick: ({ key }) => setLocale(key as 'zh-CN' | 'en-US'),
                  items: [
                    { key: 'zh-CN', label: '简体中文' },
                    { key: 'en-US', label: 'English' },
                  ],
                }}
              >
                <Button type="text" icon={<GlobalOutlined />}>
                  {locale === 'zh-CN' ? '中文' : 'EN'}
                </Button>
              </Dropdown>
            </div>
          </header>
        </ConfigProvider>
        <div
          ref={mainContentRef}
          id="main-content"
          className={styles.mainContent}
          data-route={route}
          tabIndex={-1}
          aria-label={t('mainContent')}
        >
          {content}
        </div>
        {route === 'workbench' ? (
          <>
            {importError ? (
              <Alert
                type="error"
                showIcon
                closable
                title={importError}
                onClose={clearImportError}
              />
            ) : null}
            <ImportBatchModal onConfirmed={acceptImportedSelection} />
          </>
        ) : null}
        {professional && settingsOpen && (
          <ProviderSettings
            open={professional && settingsOpen}
            includeSystemSettings={false}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {commandOpen && (
          <CommandPalette
            onClose={() => setCommandOpen(false)}
            onCreate={() => setCreateOpen(true)}
            onOpenWorkbench={openWorkbench}
            onNavigate={(next) => (next === 'workbench' ? openWorkbench() : openRoute(next))}
          />
        )}
        {createOpen && (
          <CreateTextResultModal
            open
            onCancel={() => setCreateOpen(false)}
            onCreated={(id) => {
              setCreateOpen(false);
              openResult(id);
            }}
          />
        )}
        <OnboardingDialog
          open={onboardingOpen}
          onFinish={completeOnboarding}
          onSkip={completeOnboarding}
        />
      </div>
    </ConfigProvider>
  );
}
