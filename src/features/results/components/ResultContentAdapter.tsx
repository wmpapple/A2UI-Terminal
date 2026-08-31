import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Input, Select, Space, Tag } from 'antd';
import TextArea from 'antd/es/input/TextArea';
import { useI18n } from '../../../app/i18n/useI18n';
import type { MessageKey } from '../../../app/i18n/messages';
import { renderSafeMarkdown } from '../../../shared/markdown/renderSafeMarkdown';
import type { ResultType, TextResultFormat } from '../../../shared/types/domain';
import {
  parseChecklist,
  parseCsv,
  parseForm,
  parseTool,
  serializeChecklist,
  serializeForm,
  serializeTool,
  type ChecklistItem,
  type FormField,
  type ToolSetting,
} from '../resultAdapters';
import styles from './ResultWorkbench.module.css';

interface Props {
  type: ResultType;
  format: TextResultFormat;
  content: string;
  editable: boolean;
  viewMode: 'preview' | 'edit';
  onChange: (content: string) => void;
}

const newId = (prefix: string, size: number) => `${prefix}-${Date.now()}-${size + 1}`;
const formFieldLabels: Record<FormField['kind'], MessageKey> = {
  text: 'formField_text',
  number: 'formField_number',
  date: 'formField_date',
  checkbox: 'formField_checkbox',
};

function RawEditor({
  content,
  editable,
  onChange,
}: Pick<Props, 'content' | 'editable' | 'onChange'>) {
  const { t } = useI18n();
  return (
    <TextArea
      className={styles.editor}
      aria-label={t('resultEditor')}
      value={content}
      disabled={!editable}
      onChange={(event) => onChange(event.target.value)}
      autoSize={false}
    />
  );
}

function StructuredError(props: Pick<Props, 'content' | 'editable' | 'onChange'>) {
  const { t } = useI18n();
  return (
    <div className={styles.structuredFallback}>
      <Alert type="error" showIcon title={t('resultStructuredInvalid')} />
      <RawEditor {...props} />
    </div>
  );
}

function SpreadsheetAdapter(props: Props) {
  const { t } = useI18n();
  let rows: string[][];
  try {
    rows = parseCsv(props.content);
  } catch {
    return <StructuredError {...props} />;
  }
  const width = Math.max(0, ...rows.map((row) => row.length));
  return (
    <div className={styles.typedEditor}>
      {props.viewMode === 'edit' ? <RawEditor {...props} /> : null}
      <div className={styles.tablePreview} aria-label={t('resultSpreadsheetPreview')}>
        <div className={styles.adapterSummary}>
          <Tag>{t('resultRows').replace('{count}', String(rows.length))}</Tag>
          <Tag>{t('resultColumns').replace('{count}', String(width))}</Tag>
        </div>
        <table>
          <tbody>
            {rows.slice(0, 200).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: width }, (_, columnIndex) =>
                  rowIndex === 0 ? (
                    <th key={columnIndex}>{row[columnIndex] ?? ''}</th>
                  ) : (
                    <td key={columnIndex}>{row[columnIndex] ?? ''}</td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChecklistAdapter(props: Props) {
  const { t } = useI18n();
  let items: ChecklistItem[];
  try {
    items = parseChecklist(props.content);
    if (
      items.some(
        (item) =>
          typeof item.id !== 'string' ||
          typeof item.text !== 'string' ||
          typeof item.completed !== 'boolean'
      )
    )
      throw new Error('invalid');
  } catch {
    return <StructuredError {...props} />;
  }
  const update = (next: ChecklistItem[]) => props.onChange(serializeChecklist(next));
  return (
    <div className={styles.structuredEditor} aria-label={t('resultChecklistEditor')}>
      {items.map((item, index) => (
        <div className={styles.structuredRow} key={item.id}>
          <Checkbox
            checked={item.completed}
            disabled={!props.editable || props.viewMode === 'preview'}
            onChange={(event) =>
              update(
                items.map((entry, at) =>
                  at === index ? { ...entry, completed: event.target.checked } : entry
                )
              )
            }
          />
          {props.viewMode === 'edit' ? (
            <Input
              value={item.text}
              maxLength={500}
              onChange={(event) =>
                update(
                  items.map((entry, at) =>
                    at === index ? { ...entry, text: event.target.value } : entry
                  )
                )
              }
            />
          ) : (
            <span className={item.completed ? styles.completedItem : undefined}>{item.text}</span>
          )}
          {props.viewMode === 'edit' ? (
            <Button
              danger
              type="text"
              aria-label={t('deleteItem')}
              icon={<DeleteOutlined />}
              onClick={() => update(items.filter((_, at) => at !== index))}
            />
          ) : null}
        </div>
      ))}
      {props.viewMode === 'edit' ? (
        <Button
          icon={<PlusOutlined />}
          onClick={() =>
            update([
              ...items,
              { id: newId('item', items.length), text: t('newChecklistItem'), completed: false },
            ])
          }
        >
          {t('addItem')}
        </Button>
      ) : null}
    </div>
  );
}

function FormAdapter(props: Props) {
  const { t } = useI18n();
  let fields: FormField[];
  try {
    fields = parseForm(props.content);
    if (
      fields.some(
        (field) =>
          typeof field.id !== 'string' ||
          typeof field.label !== 'string' ||
          !['text', 'number', 'date', 'checkbox'].includes(field.kind) ||
          typeof field.required !== 'boolean'
      )
    )
      throw new Error('invalid');
  } catch {
    return <StructuredError {...props} />;
  }
  const update = (next: FormField[]) => props.onChange(serializeForm(next));
  return (
    <div className={styles.structuredEditor} aria-label={t('resultFormEditor')}>
      {fields.map((field, index) => (
        <div className={styles.formField} key={field.id}>
          {props.viewMode === 'edit' ? (
            <>
              <Input
                value={field.label}
                maxLength={500}
                onChange={(event) =>
                  update(
                    fields.map((entry, at) =>
                      at === index ? { ...entry, label: event.target.value } : entry
                    )
                  )
                }
              />
              <Select
                value={field.kind}
                options={['text', 'number', 'date', 'checkbox'].map((kind) => ({
                  value: kind,
                  label: t(formFieldLabels[kind as FormField['kind']]),
                }))}
                onChange={(kind: FormField['kind']) =>
                  update(fields.map((entry, at) => (at === index ? { ...entry, kind } : entry)))
                }
              />
              <Checkbox
                className={styles.requiredToggle}
                checked={field.required}
                onChange={(event) =>
                  update(
                    fields.map((entry, at) =>
                      at === index ? { ...entry, required: event.target.checked } : entry
                    )
                  )
                }
              >
                {t('requiredField')}
              </Checkbox>
              <Button
                danger
                type="text"
                aria-label={t('deleteItem')}
                icon={<DeleteOutlined />}
                onClick={() => update(fields.filter((_, at) => at !== index))}
              />
            </>
          ) : (
            <label className={styles.formPreview}>
              <strong>{field.label}</strong>
              {field.required ? <Tag color="red">{t('requiredField')}</Tag> : null}
              {field.kind === 'checkbox' ? (
                <Checkbox disabled />
              ) : (
                <Input type={field.kind} disabled />
              )}
            </label>
          )}
        </div>
      ))}
      {props.viewMode === 'edit' ? (
        <Button
          icon={<PlusOutlined />}
          onClick={() =>
            update([
              ...fields,
              {
                id: newId('field', fields.length),
                label: t('newFormField'),
                kind: 'text',
                required: false,
              },
            ])
          }
        >
          {t('addField')}
        </Button>
      ) : null}
    </div>
  );
}

function ToolAdapter(props: Props) {
  const { t } = useI18n();
  let settings: ToolSetting[];
  try {
    settings = parseTool(props.content);
    if (
      settings.some(
        (setting) =>
          typeof setting.key !== 'string' ||
          typeof setting.label !== 'string' ||
          typeof setting.value !== 'string'
      )
    )
      throw new Error('invalid');
  } catch {
    if (!props.editable) {
      return (
        <div className={styles.toolSnapshot}>
          <Alert type="info" showIcon title={t('a2uiToolAutoSaved')} />
          <pre>{props.content}</pre>
        </div>
      );
    }
    return <StructuredError {...props} />;
  }
  const update = (next: ToolSetting[]) => props.onChange(serializeTool(next));
  return (
    <div className={styles.structuredEditor} aria-label={t('resultToolEditor')}>
      {!props.editable ? <Alert type="info" showIcon title={t('a2uiToolAutoSaved')} /> : null}
      {settings.map((setting, index) => (
        <div className={styles.toolSetting} key={setting.key}>
          {props.viewMode === 'edit' && props.editable ? (
            <>
              <Input
                value={setting.key}
                maxLength={80}
                addonBefore={t('settingKey')}
                onChange={(event) =>
                  update(
                    settings.map((entry, at) =>
                      at === index ? { ...entry, key: event.target.value } : entry
                    )
                  )
                }
              />
              <Input
                value={setting.label}
                maxLength={500}
                addonBefore={t('settingLabel')}
                onChange={(event) =>
                  update(
                    settings.map((entry, at) =>
                      at === index ? { ...entry, label: event.target.value } : entry
                    )
                  )
                }
              />
              <Input
                value={setting.value}
                maxLength={2000}
                addonBefore={t('settingValue')}
                onChange={(event) =>
                  update(
                    settings.map((entry, at) =>
                      at === index ? { ...entry, value: event.target.value } : entry
                    )
                  )
                }
              />
              <Button
                danger
                type="text"
                aria-label={t('deleteItem')}
                icon={<DeleteOutlined />}
                onClick={() => update(settings.filter((_, at) => at !== index))}
              />
            </>
          ) : (
            <Space>
              <strong>{setting.label}</strong>
              <Tag>{setting.key}</Tag>
              <span>{setting.value}</span>
            </Space>
          )}
        </div>
      ))}
      {props.viewMode === 'edit' && props.editable ? (
        <Button
          icon={<PlusOutlined />}
          onClick={() =>
            update([
              ...settings,
              {
                key: newId('setting', settings.length),
                label: t('newToolSetting'),
                value: '',
              },
            ])
          }
        >
          {t('addSetting')}
        </Button>
      ) : null}
    </div>
  );
}

export function ResultContentAdapter(props: Props) {
  const { t } = useI18n();
  if (props.type === 'spreadsheet') return <SpreadsheetAdapter {...props} />;
  if (props.type === 'checklist') return <ChecklistAdapter {...props} />;
  if (props.type === 'form') return <FormAdapter {...props} />;
  if (props.type === 'tool') return <ToolAdapter {...props} />;
  if (props.type === 'document' && props.viewMode === 'preview') {
    if (props.format !== 'markdown') {
      return (
        <pre className={styles.textPreview} aria-label={t('resultPreview')}>
          {props.content}
        </pre>
      );
    }
    return (
      <article
        className={styles.markdownPreview}
        aria-label={t('resultPreview')}
        dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(props.content) }}
      />
    );
  }
  return <RawEditor {...props} />;
}
