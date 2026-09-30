import { Alert, Select } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import type { BindingChoice, ToolBinding } from '../../shared/types/sceneTool';
import { sceneToolController } from './sceneToolController';
export function BindingPicker({
  value,
  onChange,
  requiredDocument = false,
  disabled = false,
  excludeId,
}: {
  value: ToolBinding;
  onChange: (value: ToolBinding) => void;
  requiredDocument?: boolean;
  disabled?: boolean;
  excludeId?: string;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [choices, setChoices] = useState<BindingChoice[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void sceneToolController
      .listTargets()
      .then((v) => {
        if (active) setChoices(v);
      })
      .catch((e: { message?: string }) => {
        if (active) setError(e.message ?? String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  const key = (v: ToolBinding) => JSON.stringify(v);
  const kind = (v: ToolBinding) =>
    ({
      none: zh ? '独立使用' : 'Standalone',
      document: zh ? '文档' : 'Document',
      result: zh ? '成果' : 'Result',
      task: zh ? '任务' : 'Task',
      workspace: zh ? '工作区' : 'Workspace',
    })[v.type];
  const options = choices
    .filter(
      (c) =>
        (!requiredDocument || c.binding.type === 'document') &&
        (!('targetId' in c.binding) || c.binding.targetId !== excludeId) &&
        !(
          c.binding.type === 'document' &&
          c.binding.target.kind === 'result' &&
          c.binding.target.resultId === excludeId
        )
    )
    .map((c) => ({ value: key(c.binding), label: kind(c.binding) + ' · ' + c.title }));
  if (!requiredDocument)
    options.unshift({
      value: key({ type: 'none' }),
      label: zh ? '独立使用（不关联对象）' : 'Standalone (no binding)',
    });
  if (value.type !== 'none' && !options.some((o) => o.value === key(value)))
    options.unshift({ value: key(value), label: zh ? '当前关联对象' : 'Current target' });
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      {zh
        ? requiredDocument
          ? '目标文档（必选）'
          : '关联对象（可独立使用）'
        : requiredDocument
          ? 'Target document (required)'
          : 'Target (optional)'}
      <Select
        aria-label={zh ? '关联对象' : 'Binding target'}
        style={{ width: '100%' }}
        showSearch
        optionFilterProp="label"
        value={requiredDocument && value.type !== 'document' ? undefined : key(value)}
        placeholder={zh ? '选择目标文档' : 'Choose a document'}
        disabled={disabled}
        options={options}
        onChange={(v) => onChange(JSON.parse(v) as ToolBinding)}
      />
      {error ? <Alert type="error" title={error} /> : null}
    </label>
  );
}
