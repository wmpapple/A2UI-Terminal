import { EyeOutlined } from '@ant-design/icons';
import { Switch, Tooltip } from 'antd';
import { useContext } from 'react';
import { useI18n } from './i18n/useI18n';
import { WorkbenchAppearanceContext } from './workbenchAppearanceContext';
import styles from './WorkbenchAppearance.module.css';

export function WorkbenchAppearanceControl() {
  const appearance = useContext(WorkbenchAppearanceContext);
  const { t } = useI18n();
  if (!appearance) return null;
  return (
    <Tooltip title={t('eyeCareDescription')}>
      <span className={styles.control}>
        <EyeOutlined aria-hidden="true" />
        <span>{t('eyeCareMode')}</span>
        <Switch
          size="small"
          checked={appearance.enabled}
          onChange={appearance.changeMode}
          aria-label={t('eyeCareMode')}
        />
      </span>
    </Tooltip>
  );
}
