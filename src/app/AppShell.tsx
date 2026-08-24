import {
  AppstoreOutlined,
  FileDoneOutlined,
  GlobalOutlined,
  HomeOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { Button, ConfigProvider, Dropdown, message, Tag } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { ChatPanel } from '../features/chat/components/ChatPanel';
import { HomePage } from '../features/home/components/HomePage';
import { OnboardingDialog } from '../features/home/components/OnboardingDialog';
import { scheduleAutomaticUpdateCheck } from '../features/settings/appUpdater';
import { ProviderSettings } from '../features/settings/components/ProviderSettings';
import { ResultsPage } from '../features/results/components/ResultsPage';
import { ResultAssistantPanel } from '../features/results/components/ResultAssistantPanel';
import { ResultWorkbench } from '../features/results/components/ResultWorkbench';
import { EditorPane } from '../features/workspace/components/EditorPane';
import { WorkspaceSidebar } from '../features/workspace/components/WorkspaceSidebar';
import { getRuntimeMode } from '../shared/platform/runtime';
import type { ResultAppliedReview } from '../shared/types/domain';
import { useAppStore } from '../stores/useAppStore';
import { useI18n } from './i18n/useI18n';
import styles from './AppShell.module.css';
import { SettingsPage } from './SettingsPage';
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
import { WorkspaceLayout } from './WorkspaceLayout';

export function AppShell() {
  const { locale, setLocale, t } = useI18n();
  const mode = getRuntimeMode();
  const initializeWorkspace = useAppStore((state) => state.initializeWorkspace);
  const initializeProviders = useAppStore((state) => state.initializeProviders);
  const patchApplying = useAppStore((state) => state.patchApplying);
  const patchError = useAppStore((state) => state.patchError);
  const undoLastPatch = useAppStore((state) => state.undoLastPatch);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => !readOnboardingComplete());
  const [experienceMode, setExperienceMode] = useState(readExperienceMode);
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [messageApi, messageContextHolder] = message.useMessage();
  const professional = experienceMode === 'professional';

  useEffect(() => {
    void initializeWorkspace();
    void initializeProviders();
  }, [initializeProviders, initializeWorkspace]);

  useEffect(() => scheduleAutomaticUpdateCheck(), []);

  useEffect(() => {
    const syncRoute = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

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

  const openResult = (resultId: string) => openWorkbench(resultId);

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
          activeResultId ? <ResultAssistantPanel /> : <ChatPanel professionalTools={professional} />
        }
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
        token: {
          colorPrimary: '#635bff',
          borderRadius: 8,
          fontFamily: 'Inter, "Segoe UI", sans-serif',
        },
      }}
    >
      {messageContextHolder}
      <div className={styles.app}>
        <header className={styles.titlebar} data-tauri-drag-region>
          <div className={styles.brand} data-tauri-drag-region>
            <span className={styles.logo}>A</span>
            <strong>{t('appName')}</strong>
            <Tag color="purple">V2.0</Tag>
          </div>
          <nav className={styles.navigation} aria-label={t('mainNavigation')}>
            {navigationItems.map((item) => (
              <Button
                key={item.route}
                type={route === item.route ? 'primary' : 'text'}
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
          <div className={styles.titleActions}>
            <Tag color={professional ? 'purple' : 'green'}>
              {t(professional ? 'professionalMode' : 'simpleMode')}
            </Tag>
            {professional ? (
              <Tag color={mode === 'web-mock' ? 'blue' : 'green'}>
                {mode === 'web-mock' ? t('mockMode') : 'Desktop'}
              </Tag>
            ) : null}
            <Dropdown
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
        {content}
        <ProviderSettings
          open={professional && settingsOpen}
          includeSystemSettings={false}
          onClose={() => setSettingsOpen(false)}
        />
        <OnboardingDialog
          open={onboardingOpen}
          onFinish={completeOnboarding}
          onSkip={completeOnboarding}
        />
      </div>
    </ConfigProvider>
  );
}
