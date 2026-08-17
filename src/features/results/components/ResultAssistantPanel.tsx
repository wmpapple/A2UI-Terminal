import { RobotOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Alert, Empty, Tag } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import styles from './ResultWorkbench.module.css';

export function ResultAssistantPanel() {
  const { t } = useI18n();
  return (
    <aside className={styles.assistant} aria-label={t('resultAssistant')}>
      <header className={styles.assistantHeader}>
        <RobotOutlined />
        <strong>{t('resultAssistant')}</strong>
        <Tag color="green" icon={<SafetyCertificateOutlined />}>
          {t('localOnly')}
        </Tag>
      </header>
      <Alert type="info" showIcon title={t('resultAssistantContextNotice')} />
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('resultAssistantPending')} />
    </aside>
  );
}
