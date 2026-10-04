import { FileTextOutlined, PlusOutlined, ToolOutlined } from '@ant-design/icons';
import { Button, Checkbox } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ContextSelection } from '../../../shared/types/domain';
import type { LinkedMaterial } from '../useToolLinkedMaterial';
import styles from './ChatPanel.module.css';

export function ToolAssistantContext({
  toolId,
  title,
  hasData,
  linkedTitle,
  linkedIsDocument,
  linkedMaterial,
  linkedMaterialSelected,
  hasSelectedMaterial,
  selection,
  onOpenContext,
  onToggleLinkedMaterial,
  onTask,
}: {
  toolId: string | null;
  title: string;
  hasData: boolean;
  linkedTitle: string | null;
  linkedIsDocument: boolean;
  linkedMaterial: LinkedMaterial | null;
  linkedMaterialSelected: boolean;
  hasSelectedMaterial: boolean;
  selection: ContextSelection;
  onOpenContext: () => void;
  onToggleLinkedMaterial: () => void;
  onTask: (prompt: string) => void;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const tasks = zh
    ? [
        ['帮我填写', '请根据当前工具字段给出填写建议，不要直接修改工具。'],
        ['检查遗漏', '请检查当前工具的已填内容，指出遗漏和待核实项。'],
        ['根据资料补全', '请根据我明确选择的资料，为当前工具提出补全建议，并指出来源。'],
        ['生成结论', '请根据当前工具的已填内容生成简洁结论。'],
      ]
    : [
        ['Help fill', 'Suggest how to fill the current tool fields. Do not modify the tool.'],
        ['Check gaps', 'Check the current tool content for missing or unverified items.'],
        [
          'Use documents',
          'Suggest additions using only materials I explicitly selected and cite them.',
        ],
        ['Draft conclusion', 'Draft a concise conclusion from the current tool content.'],
      ];
  return (
    <section className={styles.documentContext} aria-label={zh ? '当前工具' : 'Current tool'}>
      <h2>{zh ? '当前工具' : 'Current tool'}</h2>
      <div className={styles.contextDocument}>
        <ToolOutlined />
        <strong>{toolId ? title : zh ? '未选择工具' : 'No tool selected'}</strong>
      </div>
      <h2>{zh ? '关联对象' : 'Linked object'}</h2>
      <div className={styles.contextDocument}>
        <FileTextOutlined />
        <strong>{linkedTitle ?? (zh ? '未关联' : 'Unlinked')}</strong>
      </div>
      <h2>{zh ? '上下文' : 'Context'}</h2>
      <div className={styles.contextSources}>
        <Checkbox
          checked={hasData && selection.selection}
          disabled={!hasData}
          onChange={onOpenContext}
        >
          {zh ? '当前工具' : 'Current tool'}
        </Checkbox>
        {linkedTitle ? (
          <Checkbox
            checked={linkedMaterialSelected}
            disabled={!linkedMaterial}
            onChange={onToggleLinkedMaterial}
          >
            {zh
              ? `${linkedIsDocument ? '关联文档' : '关联对象'} ${linkedTitle}`
              : `${linkedIsDocument ? 'Linked document' : 'Linked object'} ${linkedTitle}`}
          </Checkbox>
        ) : null}
        <Checkbox checked={false} disabled>
          {zh ? '当前选区' : 'Current selection'}
        </Checkbox>
        <Button size="small" type="text" icon={<PlusOutlined />} onClick={onOpenContext}>
          {zh ? '添加资料' : 'Add material'}
        </Button>
      </div>
      <h2>{zh ? '快捷任务' : 'Quick tasks'}</h2>
      <div className={styles.contextTasks}>
        {tasks.map(([label, prompt], index) => (
          <Button
            key={label}
            size="small"
            disabled={!toolId || (index === 2 && !hasSelectedMaterial)}
            onClick={() => onTask(prompt)}
          >
            {label}
          </Button>
        ))}
      </div>
    </section>
  );
}
