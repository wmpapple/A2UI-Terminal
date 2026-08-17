import { SettingOutlined, ToolOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Segmented } from 'antd';
import { SystemSettings } from '../features/settings/components/SystemSettings';
import type { ExperienceMode } from './shellPreferences';
import { useI18n } from './i18n/useI18n';
import styles from './SettingsPage.module.css';

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

  return (
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
        <Card>
          <SystemSettings />
        </Card>
      </div>
    </main>
  );
}
