import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Input,
  Progress,
  Select,
  Tabs,
  Tag,
} from 'antd';
import type { FormEvent, ReactNode } from 'react';
import type { A2uiNode, A2uiSurface } from '../../../shared/types/domain';
import styles from './A2uiRuntime.module.css';

interface RuntimeProps {
  surface: A2uiSurface;
  disabled?: boolean;
  onAction: (componentId: string, eventName: string, payload: unknown) => void | Promise<void>;
}

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const bool = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;
const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' ? value : fallback;

interface ChecklistItem {
  key: string;
  label: string;
  disabled?: boolean;
}

interface TableColumn {
  key: string;
  label: string;
  align?: 'start' | 'center' | 'end';
}

const checklistItems = (value: unknown): ChecklistItem[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is ChecklistItem =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as { key?: unknown }).key === 'string' &&
          typeof (item as { label?: unknown }).label === 'string'
      )
    : [];

const tableColumns = (value: unknown): TableColumn[] =>
  Array.isArray(value)
    ? value.filter(
        (column): column is TableColumn =>
          typeof column === 'object' &&
          column !== null &&
          typeof (column as { key?: unknown }).key === 'string' &&
          typeof (column as { label?: unknown }).label === 'string'
      )
    : [];

const displayCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
};

const findInputByName = (node: A2uiNode, name: string): A2uiNode | null => {
  if (text(node.props.name) === name) return node;
  for (const child of node.children) {
    const match = findInputByName(child, name);
    if (match) return match;
  }
  return null;
};

const summaryValue = (surface: A2uiSurface, field: A2uiNode): string => {
  const name = text(field.props.name);
  const value = surface.data[name] ?? field.props.value ?? field.props.checked ?? '';
  if (field.component === 'Checklist') {
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
    const items = checklistItems(field.props.items);
    const labels = items.filter((item) => selected.includes(item.key)).map((item) => item.label);
    return labels.length
      ? `${labels.join('、')}（${labels.length}/${items.length}）`
      : `尚未完成（0/${items.length}）`;
  }
  if (field.component === 'Select') {
    const options = Array.isArray(field.props.options) ? field.props.options : [];
    const selected = options.find(
      (option) =>
        typeof option === 'object' &&
        option !== null &&
        (option as { value?: unknown }).value === value
    ) as { label?: unknown } | undefined;
    return text(selected?.label, text(value, '未填写'));
  }
  if (field.component === 'Checkbox') return value === true ? '是' : '否';
  return text(value, '未填写');
};

export function A2uiRuntime({ surface, disabled, onAction }: RuntimeProps) {
  const renderNode = (node: A2uiNode): ReactNode => {
    const children = node.children.map((child) => (
      <div className={styles.child} key={child.id} data-a2ui-node={child.id}>
        {renderNode(child)}
      </div>
    ));
    const trigger = (eventName: string, payload: unknown = null) => {
      if (!node.actions[eventName] || disabled) return;
      void onAction(node.id, eventName, payload);
    };
    const name = text(node.props.name);
    const value = name ? (surface.data[name] ?? node.props.value ?? '') : (node.props.value ?? '');

    switch (node.component) {
      case 'Row':
        return (
          <div
            className={`${styles.row} ${styles[`gap_${text(node.props.gap, 'md')}`] ?? ''}`}
            data-align={text(node.props.align, 'stretch')}
            data-justify={text(node.props.justify, 'start')}
            data-wrap={bool(node.props.wrap)}
          >
            {children}
          </div>
        );
      case 'Column':
        return (
          <div
            className={`${styles.column} ${styles[`gap_${text(node.props.gap, 'md')}`] ?? ''}`}
            data-align={text(node.props.align, 'stretch')}
            data-justify={text(node.props.justify, 'start')}
          >
            {children}
          </div>
        );
      case 'Stack':
        return <div className={styles.stack}>{children}</div>;
      case 'Text':
        return (
          <span
            className={styles.text}
            data-variant={text(node.props.variant, 'body')}
            data-tone={text(node.props.tone, 'default')}
            data-weight={text(node.props.weight, 'regular')}
          >
            {text(node.props.text)}
          </span>
        );
      case 'Card':
        return (
          <Card
            size="small"
            title={text(node.props.title) || undefined}
            bordered={bool(node.props.bordered, true)}
          >
            {children}
          </Card>
        );
      case 'Badge':
        return <Tag color={text(node.props.tone, 'default')}>{text(node.props.text)}</Tag>;
      case 'Progress':
        return (
          <div className={styles.field}>
            {text(node.props.label) ? <label>{text(node.props.label)}</label> : null}
            <Progress
              percent={number(node.props.value)}
              status={
                text(node.props.status, 'normal') as 'normal' | 'success' | 'exception' | 'active'
              }
            />
          </div>
        );
      case 'TextField':
        return (
          <label className={styles.field}>
            <span>{text(node.props.label, name)}</span>
            <Input
              name={name}
              value={String(value ?? '')}
              placeholder={text(node.props.placeholder)}
              required={bool(node.props.required)}
              disabled={disabled || bool(node.props.disabled)}
              maxLength={number(node.props.maxLength, 1000)}
              onChange={(event) => trigger('change', event.target.value)}
            />
          </label>
        );
      case 'Select': {
        const options = Array.isArray(node.props.options)
          ? node.props.options.filter(
              (option): option is { label: string; value: string } =>
                typeof option === 'object' &&
                option !== null &&
                typeof (option as { label?: unknown }).label === 'string' &&
                typeof (option as { value?: unknown }).value === 'string'
            )
          : [];
        if (bool(node.props.allowCustom, true)) {
          return (
            <label className={styles.field}>
              <span>{text(node.props.label, name)}</span>
              <AutoComplete
                aria-label={text(node.props.label, name)}
                value={String(value ?? '')}
                options={options}
                placeholder={text(node.props.placeholder)}
                disabled={disabled || bool(node.props.disabled)}
                onChange={(next) => trigger('change', next)}
                filterOption={(input, option) =>
                  String(option?.label ?? option?.value ?? '')
                    .toLocaleLowerCase()
                    .includes(input.toLocaleLowerCase())
                }
              />
            </label>
          );
        }
        return (
          <label className={styles.field}>
            <span>{text(node.props.label, name)}</span>
            <Select
              aria-label={text(node.props.label, name)}
              value={String(value ?? '') || undefined}
              options={options}
              placeholder={text(node.props.placeholder)}
              disabled={disabled || bool(node.props.disabled)}
              onChange={(next) => trigger('change', next)}
            />
          </label>
        );
      }
      case 'Checkbox':
        return (
          <Checkbox
            name={name}
            checked={Boolean(surface.data[name] ?? node.props.checked ?? false)}
            disabled={disabled || bool(node.props.disabled)}
            onChange={(event) => trigger('change', event.target.checked)}
          >
            {text(node.props.label, name)}
          </Checkbox>
        );
      case 'Button':
        return (
          <Button
            type={text(node.props.variant) === 'primary' ? 'primary' : 'default'}
            danger={text(node.props.variant) === 'danger'}
            disabled={disabled || bool(node.props.disabled)}
            onClick={() => trigger('click', surface.data)}
          >
            {text(node.props.label)}
          </Button>
        );
      case 'Tabs': {
        const items = Array.isArray(node.props.items)
          ? node.props.items.filter(
              (item): item is { key: string; label: string } =>
                typeof item === 'object' &&
                item !== null &&
                typeof (item as { key?: unknown }).key === 'string' &&
                typeof (item as { label?: unknown }).label === 'string'
            )
          : [];
        return (
          <Tabs
            activeKey={text(node.props.activeKey) || undefined}
            items={items.map((item, index) => ({
              key: item.key,
              label: item.label,
              children: children[index],
            }))}
            onChange={(key) => trigger('tab_change', key)}
          />
        );
      }
      case 'Form':
        return (
          <form
            className={styles.form}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              trigger('submit', surface.data);
            }}
          >
            {children}
          </form>
        );
      case 'Checklist': {
        const items = checklistItems(node.props.items);
        const initial = Array.isArray(node.props.value)
          ? node.props.value.filter((item): item is string => typeof item === 'string')
          : [];
        const selected = Array.isArray(surface.data[name])
          ? surface.data[name].filter((item): item is string => typeof item === 'string')
          : initial;
        const label = text(node.props.label, name);
        return (
          <fieldset className={styles.checklist} disabled={disabled || bool(node.props.disabled)}>
            <legend>{label}</legend>
            {items.map((item) => {
              const checked = selected.includes(item.key);
              return (
                <Checkbox
                  key={item.key}
                  checked={checked}
                  disabled={disabled || bool(node.props.disabled) || item.disabled === true}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...selected.filter((key) => key !== item.key), item.key]
                      : selected.filter((key) => key !== item.key);
                    trigger('change', next);
                  }}
                >
                  {item.label}
                </Checkbox>
              );
            })}
          </fieldset>
        );
      }
      case 'Owner': {
        const displayName = text(node.props.displayName);
        const initials = text(node.props.initials) || displayName.slice(0, 2).toLocaleUpperCase();
        return (
          <div
            className={styles.owner}
            aria-label={`${text(node.props.label, '负责人')}：${displayName}`}
          >
            <span className={styles.ownerAvatar} aria-hidden="true">
              {initials}
            </span>
            <span>
              <strong>{displayName}</strong>
              {text(node.props.detail) ? <small>{text(node.props.detail)}</small> : null}
            </span>
          </div>
        );
      }
      case 'Date': {
        const label = text(node.props.label, name);
        return (
          <label className={styles.field}>
            <span>{label}</span>
            <input
              className={styles.dateInput}
              type="date"
              name={name}
              value={typeof value === 'string' ? value : ''}
              min={text(node.props.min) || undefined}
              max={text(node.props.max) || undefined}
              required={bool(node.props.required)}
              disabled={disabled || bool(node.props.disabled)}
              onChange={(event) => trigger('change', event.target.value)}
            />
          </label>
        );
      }
      case 'Status': {
        const statusText = text(node.props.text);
        return (
          <span
            className={styles.status}
            role="status"
            aria-label={`${text(node.props.label, '状态')}：${statusText}`}
          >
            <Tag color={text(node.props.tone, 'default')}>{statusText}</Tag>
          </span>
        );
      }
      case 'Table': {
        const columns = tableColumns(node.props.columns);
        const rows = Array.isArray(node.props.rows)
          ? node.props.rows.filter(
              (row): row is Record<string, unknown> =>
                typeof row === 'object' && row !== null && !Array.isArray(row)
            )
          : [];
        return (
          <div
            className={styles.tableScroll}
            tabIndex={0}
            role="region"
            aria-label={text(node.props.caption)}
          >
            <table className={styles.table}>
              <caption>{text(node.props.caption)}</caption>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} scope="col" data-align={column.align ?? 'start'}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {columns.map((column) => (
                      <td key={column.key} data-align={column.align ?? 'start'}>
                        {displayCell(row[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case 'IssueCard': {
        const headingId = `${node.id}-title`;
        return (
          <article className={styles.issueCard} aria-labelledby={headingId}>
            <div className={styles.issueHeader}>
              <span className={styles.issueKey}>{text(node.props.issueKey)}</span>
              <Tag color={text(node.props.priority) === 'high' ? 'red' : undefined}>
                {text(node.props.priority, 'normal')}
              </Tag>
            </div>
            <h3 id={headingId}>{text(node.props.title)}</h3>
            {text(node.props.summary) ? <p>{text(node.props.summary)}</p> : null}
            <dl className={styles.issueMeta}>
              <div>
                <dt>状态</dt>
                <dd>{text(node.props.status)}</dd>
              </div>
              {text(node.props.owner) ? (
                <div>
                  <dt>负责人</dt>
                  <dd>{text(node.props.owner)}</dd>
                </div>
              ) : null}
              {text(node.props.dueDate) ? (
                <div>
                  <dt>日期</dt>
                  <dd>
                    <time dateTime={text(node.props.dueDate)}>{text(node.props.dueDate)}</time>
                  </dd>
                </div>
              ) : null}
            </dl>
            {children}
          </article>
        );
      }
      case 'ResultSummary': {
        const fields = Array.isArray(node.props.fields)
          ? node.props.fields.filter((field): field is string => typeof field === 'string')
          : [];
        return (
          <section
            className={styles.resultSummary}
            role="region"
            aria-label={text(node.props.title)}
          >
            <h3>{text(node.props.title)}</h3>
            <dl>
              {fields.map((fieldName) => {
                const field = findInputByName(surface.root, fieldName);
                if (!field) return null;
                return (
                  <div key={fieldName}>
                    <dt>{text(field.props.label, fieldName)}</dt>
                    <dd>{summaryValue(surface, field)}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      }
      default:
        return (
          <Alert type="error" showIcon title={`Unsupported component: ${String(node.component)}`} />
        );
    }
  };

  return (
    <section className={styles.surface} aria-label={`A2UI Surface ${surface.surfaceId}`}>
      {renderNode(surface.root)}
    </section>
  );
}
