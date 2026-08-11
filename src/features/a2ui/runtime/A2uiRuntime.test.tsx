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
  data: { name: 'Ada', role: 'developer', enabled: true },
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
  ]),
};

describe('A2uiRuntime', () => {
  it('renders the fixed Basic Catalog without dynamic HTML execution', () => {
    const { container } = render(<A2uiRuntime surface={surface} onAction={() => undefined} />);
    expect(screen.getByText('Trusted surface')).toBeInTheDocument();
    expect(screen.getByText('Safe')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Ada');
    expect(screen.getByText('Tab content')).toBeInTheDocument();
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
});
