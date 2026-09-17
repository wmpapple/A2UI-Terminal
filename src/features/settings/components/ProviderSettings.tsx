import { DeleteOutlined, ExperimentOutlined, SaveOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  message,
} from 'antd';
import { useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { getRuntimeMode } from '../../../shared/platform/runtime';
import type { ProviderConfig } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import styles from './ProviderSettings.module.css';
import { SystemSettings } from './SystemSettings';

interface Props {
  open: boolean;
  onClose: () => void;
  includeSystemSettings?: boolean;
}

const providerNames: Record<string, string> = {
  siliconflow: 'SiliconFlow',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  custom: 'OpenAI-Compatible',
};

export function ProviderSettings({ open, onClose, includeSystemSettings = true }: Props) {
  const { t } = useI18n();
  const configs = useAppStore((state) => state.providerConfigs);
  const activeProviderId = useAppStore((state) => state.activeProviderId);
  const loading = useAppStore((state) => state.providerLoading);
  const providerError = useAppStore((state) => state.providerError);
  const saveProvider = useAppStore((state) => state.saveProvider);
  const selectProvider = useAppStore((state) => state.selectProvider);
  const deleteProviderKey = useAppStore((state) => state.deleteProviderKey);
  const testProvider = useAppStore((state) => state.testProvider);
  const localProviderProbes = useAppStore((state) => state.localProviderProbes);
  const localProbeLoading = useAppStore((state) => state.localProbeLoading);
  const localProbeError = useAppStore((state) => state.localProbeError);
  const probeLocalProviders = useAppStore((state) => state.probeLocalProviders);
  const [selectedId, setSelectedId] = useState(activeProviderId);
  const selected = configs.find((config) => config.id === selectedId) ?? configs[0];
  const [draft, setDraft] = useState<ProviderConfig | null>(selected ?? null);
  const [secret, setSecret] = useState('');

  const update = <K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]) =>
    setDraft((current) => {
      const base = current ?? selected;
      return base ? { ...base, [key]: value } : null;
    });

  const save = async () => {
    if (!draft) return;
    const pendingSecret = secret;
    setSecret('');
    try {
      await saveProvider(draft, pendingSecret);
      const refreshed = useAppStore
        .getState()
        .providerConfigs.find((config) => config.id === draft.id);
      if (refreshed) setDraft({ ...refreshed });
      message.success(t('providerSaved'));
    } catch {
      // The store exposes the sanitized backend error in the modal.
    }
  };

  const test = async () => {
    if (!draft) return;
    const pendingSecret = secret;
    setSecret('');
    try {
      await saveProvider(draft, pendingSecret);
      const refreshed = useAppStore
        .getState()
        .providerConfigs.find((config) => config.id === draft.id);
      if (refreshed) setDraft({ ...refreshed });
      const latency = await testProvider(draft.id);
      message.success(t('connectionPassed').replace('{ms}', String(latency)));
    } catch {
      // The store exposes the sanitized backend error in the modal.
    }
  };

  return (
    <Modal
      open={open}
      title={t('providerSettings')}
      onCancel={onClose}
      afterOpenChange={(opened) => {
        if (!opened) return;
        const active = configs.find((config) => config.id === activeProviderId) ?? configs[0];
        setSelectedId(active?.id ?? activeProviderId);
        setDraft(active ? { ...active } : null);
        setSecret('');
        void probeLocalProviders();
      }}
      footer={null}
      width={700}
    >
      <>
        {getRuntimeMode() === 'web-mock' ? (
          <Alert type="info" showIcon title={t('providerDesktopOnly')} />
        ) : !draft ? (
          <Alert type="warning" showIcon title={t('providerUnavailable')} />
        ) : (
          <div className={styles.body}>
            {providerError && <Alert type="error" showIcon title={providerError} />}
            <div className={styles.providerRow}>
              <Select
                value={selectedId}
                onChange={(providerId) => {
                  setSelectedId(providerId);
                  const config = configs.find((item) => item.id === providerId);
                  setDraft(config ? { ...config } : null);
                  setSecret('');
                }}
                options={configs.map((config) => ({
                  value: config.id,
                  label: providerNames[config.id] ?? config.id,
                }))}
                className={styles.providerSelect}
              />
              {draft.configured ? (
                <Tag color="green">{t('keyConfigured')}</Tag>
              ) : (
                <Tag color="orange">{t('keyMissing')}</Tag>
              )}
              {draft.id === activeProviderId && <Tag color="blue">{t('activeProvider')}</Tag>}
            </div>
            <Form layout="vertical" requiredMark={false}>
              <Form.Item label="Endpoint" required>
                <Input
                  value={draft.endpoint}
                  onChange={(event) => update('endpoint', event.target.value)}
                />
              </Form.Item>
              <Form.Item label="Model" required>
                <Input
                  value={draft.model}
                  onChange={(event) => update('model', event.target.value)}
                />
              </Form.Item>
              <div className={styles.grid}>
                <Form.Item label="Temperature">
                  <InputNumber
                    min={0}
                    max={2}
                    step={0.1}
                    value={draft.temperature}
                    onChange={(value) => update('temperature', value ?? 0.2)}
                  />
                </Form.Item>
                <Form.Item label={t('proxyAddress')}>
                  <Input
                    value={draft.proxyUrl ?? ''}
                    placeholder="http://127.0.0.1:7890"
                    onChange={(event) => update('proxyUrl', event.target.value || null)}
                  />
                </Form.Item>
              </div>
              <Form.Item label="API Key" extra={t('keyStorageHint')}>
                <Input.Password
                  value={secret}
                  autoComplete="new-password"
                  placeholder={
                    draft.configured ? t('keyKeepPlaceholder') : t('keyInputPlaceholder')
                  }
                  onChange={(event) => setSecret(event.target.value)}
                />
              </Form.Item>
              <Alert type="info" showIcon title={t('providerTimeoutPolicy')} />
            </Form>
            <Space wrap>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={loading}
                onClick={() => void save()}
              >
                {t('saveSettings')}
              </Button>
              <Button icon={<ExperimentOutlined />} loading={loading} onClick={() => void test()}>
                {t('testConnection')}
              </Button>
              {draft.id !== activeProviderId && (
                <Button onClick={() => void selectProvider(draft.id)}>
                  {t('setActiveProvider')}
                </Button>
              )}
              {draft.configured && (
                <Popconfirm
                  title={t('deleteKeyConfirm')}
                  onConfirm={() => void deleteProviderKey(draft.id)}
                >
                  <Button danger icon={<DeleteOutlined />}>
                    {t('deleteKey')}
                  </Button>
                </Popconfirm>
              )}
            </Space>
            <Divider />
            <section aria-labelledby="local-provider-probe-title">
              <div className={styles.probeHeader}>
                <div>
                  <strong id="local-provider-probe-title">{t('localProviderDetection')}</strong>
                  <p>{t('localProviderDetectionDescription')}</p>
                </div>
                <Button
                  size="small"
                  icon={<ExperimentOutlined />}
                  loading={localProbeLoading}
                  onClick={() => void probeLocalProviders()}
                >
                  {t('detectLocalProviders')}
                </Button>
              </div>
              {localProbeError ? (
                <Alert type="warning" showIcon title={t('localProbeFailureNonBlocking')} />
              ) : null}
              <List
                size="small"
                dataSource={localProviderProbes}
                locale={{ emptyText: t('localProviderProbePending') }}
                renderItem={(probe) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space wrap>
                          <span>
                            {t(
                              probe.kind === 'ollama'
                                ? 'ollamaProvider'
                                : probe.kind === 'lm_studio'
                                  ? 'lmStudioProvider'
                                  : 'customLocalProvider'
                            )}
                          </span>
                          <Tag color={probe.status === 'available' ? 'green' : 'default'}>
                            {t(
                              probe.status === 'available'
                                ? 'localProviderAvailable'
                                : 'localProviderUnavailable'
                            )}
                          </Tag>
                        </Space>
                      }
                      description={
                        <div className={styles.probeDetails}>
                          <code>{probe.endpoint}</code>
                          <span>
                            {probe.models.length > 0
                              ? t('localProviderModels').replace(
                                  '{models}',
                                  probe.models.slice(0, 5).join(', ')
                                )
                              : t(
                                  probe.status === 'available'
                                    ? 'localProviderNoModels'
                                    : 'localProviderFailureHint'
                                )}
                          </span>
                        </div>
                      }
                    />
                  </List.Item>
                )}
              />
            </section>
          </div>
        )}
        {includeSystemSettings ? <Divider /> : null}
        {includeSystemSettings ? <SystemSettings /> : null}
      </>
    </Modal>
  );
}
