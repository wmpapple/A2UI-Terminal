import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { A2uiNode, A2uiSurface } from '../../../shared/types/domain';
import { A2uiRuntime } from './A2uiRuntime';

const node = (
  id: string,
  component: A2uiNode['component'],
  props: Record<string, unknown> = {},
  children: A2uiNode[] = [],
  actions: A2uiNode['actions'] = {}
): A2uiNode => ({ id, component, props, children, actions });

const surface: A2uiSurface = {
  surfaceId: 'catalog-demo',
  workspaceId: 'workspace',
  sessionId: 'session',
  messageId: 'message',
  revision: 1,
  protocolVersion: 'v0.9.1',
  catalogId: 'urn:a2ui-terminal:catalog:basic:v1',
  data: {
    name: 'Ada',
    role: 'developer',
    enabled: true,
    doneItems: ['review'],
    dueDate: '2026-09-30',
  },
  rawMessage: '{}',
  validation: { valid: true, errors: [], warnings: [], durationMs: 1 },
  events: [],
  root: node('root', 'Column', { gap: 'md' }, [
    node('row', 'Row', { gap: 'sm' }, [node('text', 'Text', { text: 'Trusted surface' })]),
    node('stack', 'Stack'),
    node('card', 'Card', { title: 'Summary' }, [
      node('badge', 'Badge', { text: 'Safe', tone: 'success' }),
    ]),
    node('progress', 'Progress', { value: 70, label: 'Progress' }),
    node('field', 'TextField', { name: 'name', label: 'Name' }, [], {
      change: { type: 'set_state', target: 'name' },
    }),
    node(
      'select',
      'Select',
      {
        name: 'role',
        label: 'Role',
        options: [{ label: 'Developer', value: 'developer' }],
      },
      [],
      { change: { type: 'set_state', target: 'role' } }
    ),
    node('check', 'Checkbox', { name: 'enabled', label: 'Enabled' }),
    node('button', 'Button', { label: 'Continue', variant: 'primary' }),
    node('tabs', 'Tabs', { items: [{ key: 'one', label: 'One' }] }, [
      node('tab-text', 'Text', { text: 'Tab content' }),
    ]),
    node('form', 'Form', { name: 'demo' }, [node('submit', 'Button', { label: 'Submit' })]),
    node(
      'checklist',
      'Checklist',
      {
        name: 'doneItems',
        label: '发布清单',
        items: [
          { key: 'review', label: '完成评审' },
          { key: 'release', label: '准备发布' },
        ],
      },
      [],
      { change: { type: 'set_state', target: 'doneItems' } }
    ),
    node('owner', 'Owner', { displayName: 'Ada Lovelace', label: '负责人', detail: '产品' }),
    node('date', 'Date', { name: 'dueDate', label: '截止日期', value: '2026-09-30' }, [], {
      change: { type: 'set_state', target: 'dueDate' },
    }),
    node('status', 'Status', { text: '进行中', label: '状态', tone: 'info' }),
    node('table', 'Table', {
      caption: '任务概览',
      columns: [
        { key: 'task', label: '任务' },
        { key: 'progress', label: '进度', align: 'end' },
      ],
      rows: [{ task: '设计', progress: 80 }],
    }),
    node(
      'issue',
      'IssueCard',
      {
        issueKey: 'A2UI-32',
        title: '扩展大众组件',
        summary: '固定 Catalog 渲染',
        status: 'in_progress',
        priority: 'high',
        owner: 'Ada',
        dueDate: '2026-09-30',
      },
      [node('issue-note', 'Text', { text: '仅声明式内容' })]
    ),
  ]),
};

describe('A2uiRuntime', () => {
  it('renders the fixed Basic Catalog without dynamic HTML execution', () => {
    const { container } = render(<A2uiRuntime surface={surface} onAction={() => undefined} />);
    expect(screen.getByText('Trusted surface')).toBeInTheDocument();
    expect(screen.getByText('Safe')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Ada');
    expect(screen.getByText('Tab content')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '发布清单' })).toBeInTheDocument();
    expect(screen.getByLabelText('截止日期')).toHaveValue('2026-09-30');
    expect(screen.getByRole('status', { name: '状态：进行中' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '任务概览' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: '扩展大众组件' })).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('emits only declared component events', () => {
    const onAction = vi.fn();
    render(<A2uiRuntime surface={surface} onAction={onAction} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grace' } });
    expect(onAction).toHaveBeenCalledWith('field', 'change', 'Grace');
  });

  it('treats Select options as suggestions unless fixed choices are requested', () => {
    const onAction = vi.fn();
    render(<A2uiRuntime surface={surface} onAction={onAction} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), {
      target: { value: 'architect' },
    });
    expect(onAction).toHaveBeenCalledWith('select', 'change', 'architect');
  });

  it('keeps expanded inputs keyboard reachable and emits only declared state changes', () => {
    const onAction = vi.fn();
    render(<A2uiRuntime surface={surface} onAction={onAction} />);

    const date = screen.getByLabelText('截止日期');
    date.focus();
    expect(date).toHaveFocus();
    fireEvent.change(date, { target: { value: '2026-10-01' } });
    expect(onAction).toHaveBeenCalledWith('date', 'change', '2026-10-01');

    const release = screen.getByRole('checkbox', { name: '准备发布' });
    release.focus();
    expect(release).toHaveFocus();
    fireEvent.click(release);
    expect(onAction).toHaveBeenCalledWith('checklist', 'change', ['review', 'release']);

    const tableRegion = screen.getByRole('region', { name: '任务概览' });
    expect(tableRegion).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('columnheader', { name: '进度' })).toBeInTheDocument();
  });
});
