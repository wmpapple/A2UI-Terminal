import { GlobalOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, ConfigProvider, Dropdown, Tag, Tooltip } from 'antd';
import { useEffect } from 'react';
import { useState } from 'react';
import { ChatPanel } from '../features/chat/components/ChatPanel';
import { scheduleAutomaticUpdateCheck } from '../features/settings/appUpdater';
import { ProviderSettings } from '../features/settings/components/ProviderSettings';
import { EditorPane } from '../features/workspace/components/EditorPane';
import { WorkspaceSidebar } from '../features/workspace/components/WorkspaceSidebar';
import { getRuntimeMode } from '../shared/platform/runtime';
import { useAppStore } from '../stores/useAppStore';
import { useI18n } from './i18n/useI18n';
import styles from './AppShell.module.css';
import { WorkspaceLayout } from './WorkspaceLayout';

export function AppShell() {
  const { locale, setLocale, t } = useI18n();
  const mode = getRuntimeMode();
  const initializeWorkspace = useAppStore((state) => state.initializeWorkspace);
  const initializeProviders = useAppStore((state) => state.initializeProviders);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void initializeWorkspace();
    void initializeProviders();
  }, [initializeProviders, initializeWorkspace]);

  useEffect(() => scheduleAutomaticUpdateCheck(), []);

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
            <Tag color="purple">V1.0</Tag>
          </div>
          <div className={styles.titleActions}>
            <Tag color={mode === 'web-mock' ? 'blue' : 'green'}>
              {mode === 'web-mock' ? t('mockMode') : 'Desktop'}
            </Tag>
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
            <Tooltip title={t('settings')}>
              <Button
                type="text"
                aria-label={t('settings')}
                icon={<SettingOutlined />}
                onClick={() => setSettingsOpen(true)}
              />
            </Tooltip>
          </div>
        </header>
        <WorkspaceLayout
          left={<WorkspaceSidebar />}
          center={<EditorPane />}
          right={<ChatPanel />}
        />
        <ProviderSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </ConfigProvider>
  );
}
