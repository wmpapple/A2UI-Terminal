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
