import { Alert, Radio, Select } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import type { BindingChoice, ToolBinding } from '../../shared/types/sceneTool';
import { sceneToolController } from './sceneToolController';

type Scope = 'none' | 'current' | 'files' | 'results' | 'other';
const scopeOf = (binding: ToolBinding): Scope =>
  binding.type === 'none'
    ? 'none'
    : binding.type === 'document'
      ? binding.target.kind === 'workspace_file'
        ? 'files'
        : 'results'
      : binding.type === 'result'
        ? 'results'
        : 'other';

export function CreationBindingPicker({
  value,
  currentBinding,
  onChange,
  onReady,
  disabled,
}: {
  value: ToolBinding;
  currentBinding?: ToolBinding;
  onChange: (binding: ToolBinding) => void;
  onReady: (ready: boolean) => void;
  disabled: boolean;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [scope, setScope] = useState<Scope>(() => scopeOf(value));
  const [choices, setChoices] = useState<BindingChoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void sceneToolController
      .listTargets()
      .then((rows) => {
        if (active) setChoices(rows);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason && typeof reason === 'object' && 'message' in reason
              ? String(reason.message)
              : String(reason)
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const options = choices
    .filter((c) => scopeOf(c.binding) === scope)
    .map((c) => ({ value: JSON.stringify(c.binding), label: c.title }));
  if (value.type !== 'none' && !options.some((option) => option.value === JSON.stringify(value))) {
    options.unshift({
      value: JSON.stringify(value),
      label: zh ? '当前关联对象' : 'Current target',
    });
  }
  return (
    <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
      <strong>{zh ? '应用到' : 'Apply to'}</strong>
      <Radio.Group
        aria-label={zh ? '应用到' : 'Apply to'}
        value={scope}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value as Scope;
          setScope(next);
          onChange(next === 'current' && currentBinding ? currentBinding : { type: 'none' });
          onReady(next === 'none' || next === 'current');
        }}
      >
        <Radio value="none">{zh ? '独立使用' : 'Standalone'}</Radio>
        <Radio value="current" disabled={!currentBinding}>
          {zh ? '当前打开的文档' : 'Current document'}
        </Radio>
        <Radio value="files">{zh ? '从工作区选择' : 'Workspace file'}</Radio>
        <Radio value="results">{zh ? '从成果选择' : 'Saved result'}</Radio>
        <Radio value="other">{zh ? '其他对象' : 'Other target'}</Radio>
      </Radio.Group>
      {scope !== 'none' && scope !== 'current' ? (
        <Select
          aria-label={zh ? '关联对象' : 'Binding target'}
          value={value.type === 'none' ? undefined : JSON.stringify(value)}
          placeholder={zh ? '选择关联对象' : 'Select a target'}
          showSearch
          optionFilterProp="label"
          options={options}
          disabled={disabled}
          onChange={(v) => {
            onChange(JSON.parse(v) as ToolBinding);
            onReady(true);
          }}
          notFoundContent={
            zh ? '没有可选对象，可以独立创建工具' : 'No targets. You can create a standalone tool.'
          }
        />
      ) : null}
      {error && scope !== 'none' ? <Alert type="error" title={error} /> : null}
    </div>
  );
}
