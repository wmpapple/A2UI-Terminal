import { Select } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';

export function AssistantModelPicker({
  disabled,
  onChange,
}: {
  disabled: boolean;
  onChange?: () => void;
}) {
  const { locale } = useI18n();
  const providers = useAppStore((s) => s.providerConfigs);
  const active = useAppStore((s) => s.activeProviderId);
  const select = useAppStore((s) => s.selectProvider);
  return (
    <Select
      size="small"
      style={{ width: '100%', minWidth: 0 }}
      aria-label={locale === 'zh-CN' ? 'AI 模型' : 'AI model'}
      value={active}
      disabled={disabled}
      options={providers.map((p) => ({ value: p.id, label: `${p.id} · ${p.model}` }))}
      onChange={(id) => {
        onChange?.();
        void select(id);
      }}
    />
  );
}
