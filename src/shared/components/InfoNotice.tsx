import { Alert, type AlertProps } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useI18n } from '../../app/i18n/useI18n';

/** Dismissal only hides the current notice; it never changes application state. */
export function InfoNotice({ type = 'info', ...props }: AlertProps) {
  const { locale } = useI18n();
  return (
    <Alert
      key={type}
      {...props}
      type={type}
      closable={
        type === 'info'
          ? {
              closeIcon: <CloseOutlined />,
              'aria-label': locale === 'zh-CN' ? '关闭提示' : 'Dismiss notice',
            }
          : props.closable
      }
    />
  );
}
