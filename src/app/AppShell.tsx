import {
  AppstoreOutlined,
  FileDoneOutlined,
  GlobalOutlined,
  HomeOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { Button, ConfigProvider, Dropdown, Tag } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { ChatPanel } from '../features/chat/components/ChatPanel';
import { scheduleAutomaticUpdateCheck } from '../features/settings/appUpdater';
import { ProviderSettings } from '../features/settings/components/ProviderSettings';
import { EditorPane } from '../features/workspace/components/EditorPane';
import { WorkspaceSidebar } from '../features/workspace/components/WorkspaceSidebar';
import { getRuntimeMode } from '../shared/platform/runtime';
import { useAppStore } from '../stores/useAppStore';
import { useI18n } from './i18n/useI18n';
import styles from './AppShell.module.css';
import { SettingsPage } from './SettingsPage';
import { ShellPage } from './ShellPage';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [experienceMode, setExperienceMode] = useState(readExperienceMode);
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
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
    route === 'workbench' ? (
      <WorkspaceLayout
        showLeftPanel={professional}
        left={<WorkspaceSidebar />}
        center={<EditorPane showInspector={professional} showSimpleFileActions={!professional} />}
        right={<ChatPanel professionalTools={professional} />}
      />
    ) : route === 'settings' ? (
      <SettingsPage
        experienceMode={experienceMode}
        onExperienceModeChange={changeExperienceMode}
        onOpenProviderSettings={() => setSettingsOpen(true)}
      />
    ) : (
      <ShellPage route={route} onOpenWorkbench={() => openRoute('workbench')} />
    );

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
                onClick={() => openRoute(item.route)}
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
      </div>
    </ConfigProvider>
  );
}
