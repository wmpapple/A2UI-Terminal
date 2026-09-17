import { CloudOutlined, DesktopOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Tag } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import { getRuntimeMode } from '../../../shared/platform/runtime';
import { useAppStore } from '../../../stores/useAppStore';

export function ProcessingStatus() {
  const { t } = useI18n();
  const options = useAppStore((state) => state.processingOptions);
  const loading = useAppStore((state) => state.localProbeLoading);
  const error = useAppStore((state) => state.localProbeError);
  const refresh = useAppStore((state) => state.refreshProcessingOptions);
  const desktop = getRuntimeMode() === 'desktop';
  const local = options?.processingLocation === 'local';
  const statusKey = options
    ? options.availability === 'ready'
      ? local
        ? 'localModelReady'
        : 'cloudModelReady'
      : options.availability === 'setup_required'
        ? local
          ? 'localModelSetupRequired'
          : 'processingSetupRequired'
        : 'localModelUnavailable'
    : desktop
      ? 'processingStatusPending'
      : 'processingStatusDesktopOnly';

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type={options?.availability === 'ready' ? 'success' : error ? 'warning' : 'info'}
        showIcon
        title={t(statusKey)}
        description={error ? t('localProbeFailureNonBlocking') : t('processingStatusPrivacy')}
      />
      <Space wrap>
        <Tag icon={local ? <DesktopOutlined /> : <CloudOutlined />}>
          {t(local ? 'localProcessing' : 'cloudProcessing')}
        </Tag>
        {options?.localProviderAvailable ? (
          <Tag color="green">
            {t('localProvidersFound').replace('{count}', String(options.availableLocalProviders))}
          </Tag>
        ) : null}
        {desktop ? (
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void refresh()}
          >
            {t('refreshProcessingStatus')}
          </Button>
        ) : null}
      </Space>
    </Space>
  );
}
