import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { ResultContentAdapter } from './ResultContentAdapter';

const renderAdapter = (
  type: 'document' | 'spreadsheet' | 'checklist' | 'form' | 'tool',
  content: string,
  onChange = vi.fn()
) => {
  render(
    <I18nProvider>
      <ResultContentAdapter
        type={type}
        format={type === 'document' ? 'markdown' : type === 'spreadsheet' ? 'csv' : 'json'}
        content={content}
        editable
        viewMode="edit"
        onChange={onChange}
      />
    </I18nProvider>
  );
  return onChange;
};

describe('ResultContentAdapter', () => {
  it('previews CSV while retaining a canonical raw editor', () => {
    renderAdapter('spreadsheet', 'Name,Count\nAlpha,2\n');
    expect(screen.getByRole('textbox', { name: '成果编辑器' })).toHaveValue(
      'Name,Count\nAlpha,2\n'
    );
    expect(screen.getByRole('table')).toHaveTextContent('Alpha');
    expect(screen.getByText('2 行')).toBeVisible();
  });

  it('edits checklist state as stable JSON', () => {
    const onChange = renderAdapter(
      'checklist',
      JSON.stringify({ items: [{ id: 'one', text: '核对合同', completed: false }] })
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(JSON.parse(onChange.mock.calls[0][0]).items[0].completed).toBe(true);
  });

  it('adds fields through the form adapter', () => {
    const onChange = renderAdapter('form', JSON.stringify({ fields: [] }));
    fireEvent.click(screen.getByRole('button', { name: /添加字段/ }));
    expect(JSON.parse(onChange.mock.calls[0][0]).fields).toHaveLength(1);
  });

  it('keeps the required checkbox as one inline labelled control', () => {
    const onChange = renderAdapter(
      'form',
      JSON.stringify({
        fields: [{ id: 'name', label: '姓名', kind: 'text', required: false }],
      })
    );
    const required = screen.getByRole('checkbox', { name: '必填' });
    expect(required.closest('label')).toHaveClass(/requiredToggle/);
    fireEvent.click(required);
    expect(JSON.parse(onChange.mock.calls[0][0]).fields[0].required).toBe(true);
  });

  it('edits tool settings without executing code', () => {
    const onChange = renderAdapter(
      'tool',
      JSON.stringify({ settings: [{ key: 'limit', label: '上限', value: '10' }] })
    );
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '20' } });
    expect(JSON.parse(onChange.mock.calls[0][0]).settings[0].value).toBe('20');
  });

  it('falls back to a repairable raw editor for invalid structured content', () => {
    renderAdapter('checklist', '{broken');
    expect(screen.getByText(/结构化内容无效/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: '成果编辑器' })).toHaveValue('{broken');
  });
});
