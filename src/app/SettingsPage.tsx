import { SettingOutlined, ToolOutlined } from '@ant-design/icons';
import { Alert, Button, Card, ConfigProvider, Segmented } from 'antd';
import { SystemSettings } from '../features/settings/components/SystemSettings';
import { ProcessingStatus } from '../features/settings/components/ProcessingStatus';
import type { ExperienceMode } from './shellPreferences';
import { useI18n } from './i18n/useI18n';
import styles from './SettingsPage.module.css';
import { useSystemTheme } from './useSystemTheme';

interface Props {
  experienceMode: ExperienceMode;
  onExperienceModeChange: (mode: ExperienceMode) => void;
  onOpenProviderSettings: () => void;
}

export function SettingsPage({
  experienceMode,
  onExperienceModeChange,
  onOpenProviderSettings,
}: Props) {
  const { t } = useI18n();
  const professional = experienceMode === 'professional';
  const dark = useSystemTheme();
  const noticeBackground = dark ? '#302821' : '#fff8f2';
  const noticeBorder = dark ? '#514033' : '#f0dfd1';

  return (
    <ConfigProvider
      theme={{
        token: {
          colorSuccess: dark ? '#dba47e' : '#b94b19',
          colorInfo: dark ? '#dba47e' : '#b94b19',
          colorWarning: dark ? '#c9ad86' : '#8a6940',
          colorError: dark ? '#d89991' : '#963f36',
          colorSuccessBg: noticeBackground,
          colorSuccessBorder: noticeBorder,
          colorInfoBg: noticeBackground,
          colorInfoBorder: noticeBorder,
          colorWarningBg: noticeBackground,
          colorWarningBorder: noticeBorder,
          colorErrorBg: dark ? '#252d39' : '#f8fafc',
          colorErrorBorder: dark ? '#3a4555' : '#e2e8f0',
        },
      }}
    >
      <main className={styles.page} aria-labelledby="settings-page-title">
        <div className={styles.content}>
          <header>
            <SettingOutlined />
            <div>
              <h1 id="settings-page-title">{t('settingsPageTitle')}</h1>
              <p>{t('settingsPageDescription')}</p>
            </div>
          </header>
          <Card title={t('experienceModeTitle')}>
            <Segmented
              block
              value={experienceMode}
              aria-label={t('experienceModeTitle')}
              options={[
                { label: t('simpleMode'), value: 'simple' },
                { label: t('professionalMode'), value: 'professional' },
              ]}
              onChange={(value) => onExperienceModeChange(value as ExperienceMode)}
            />
            <Alert
              className={styles.modeNotice}
              type={professional ? 'info' : 'success'}
              showIcon
              title={t(professional ? 'professionalModeDescription' : 'simpleModeDescription')}
            />
            {professional ? (
              <Button icon={<ToolOutlined />} onClick={onOpenProviderSettings}>
                {t('openAdvancedProviderSettings')}
              </Button>
            ) : null}
          </Card>
          <Card title={t('processingStatusTitle')}>
            <ProcessingStatus />
          </Card>
          <Card>
            <SystemSettings />
          </Card>
        </div>
      </main>
    </ConfigProvider>
  );
}
