import { Spin } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import styles from './ChatPanel.module.css';

export function AssistantProgress({
  receiving,
  stopping = false,
}: {
  receiving: boolean;
  stopping?: boolean;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  return (
    <div className={styles.progress} role="status" aria-live="polite">
      <Spin size="small" />
      <span>
        {stopping
          ? zh
            ? '正在停止生成…'
            : 'Stopping…'
          : receiving
            ? zh
              ? '正在生成…'
              : 'Generating…'
            : zh
              ? '正在等待模型响应…'
              : 'Waiting for the model…'}
      </span>
    </div>
  );
}
