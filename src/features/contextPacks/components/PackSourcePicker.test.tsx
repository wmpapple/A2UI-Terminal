import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { DocumentSource } from '../../../shared/types/domain';
import type { KnowledgeSource } from '../../../shared/types/knowledge';
import { knowledgeController } from '../../knowledge/knowledgeController';
import { PackSourcePicker } from './PackSourcePicker';

vi.mock('../../knowledge/knowledgeController', () => ({
  knowledgeController: { list: vi.fn() },
}));

const personal = (id: string, title: string): KnowledgeSource => ({
  id,
  title,
  format: 'md',
  originalName: title,
  rawHash: id,
  extractedHash: id,
  parserVersion: 'v1',
  sourceVersion: 1,
  tags: [],
  status: 'ready',
  createdAt: '2026-10-05',
  updatedAt: '2026-10-05',
});

beforeEach(() => {
  vi.clearAllMocks();
});

it('searches personal sources, selects them, and enforces the shared 20-item limit', async () => {
  const notes = personal('k1', 'notes.md');
  vi.mocked(knowledgeController.list).mockResolvedValue({
    items: [notes, personal('k2', 'paper.md')],
    nextCursor: null,
  });
  const onChange = vi.fn();
  const onChosen = vi.fn();
  const renderPicker = (value: string[], totalSelected: number) => (
    <I18nProvider>
      <PackSourcePicker
        kind="personal"
        workspaceSources={[]}
        value={value}
        totalSelected={totalSelected}
        onChange={onChange}
        onPersonalSourceChosen={onChosen}
      />
    </I18nProvider>
  );
  const { rerender } = render(renderPicker([], 0));
  fireEvent.click(screen.getByRole('button', { name: '添加个人资料' }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索个人资料' }), {
    target: { value: 'note' },
  });
  const checkbox = await screen.findByRole('checkbox', { name: 'notes.md' });
  expect(knowledgeController.list).toHaveBeenCalledWith({ query: 'note' });
  fireEvent.click(checkbox);
  expect(onChange).toHaveBeenCalledWith(['k1']);
  expect(onChosen).toHaveBeenCalledWith(notes);
  rerender(renderPicker(['k1'], 20));
  expect(screen.getByRole('checkbox', { name: 'notes.md' })).toBeEnabled();
  expect(screen.getByRole('checkbox', { name: 'paper.md' })).toBeDisabled();
});

it('filters workspace sources without loading personal content', () => {
  const workspaceSources = [
    { id: 's1', name: 'paper.pdf' },
    { id: 's2', name: 'sales.csv' },
  ] as DocumentSource[];
  const onChange = vi.fn();
  render(
    <I18nProvider>
      <PackSourcePicker
        kind="workspace"
        workspaceSources={workspaceSources}
        value={[]}
        totalSelected={0}
        onChange={onChange}
      />
    </I18nProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: '添加工作区资料' }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索工作区资料' }), {
    target: { value: 'paper' },
  });
  expect(screen.getByRole('checkbox', { name: 'paper.pdf' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'sales.csv' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'paper.pdf' }));
  expect(onChange).toHaveBeenCalledWith(['s1']);
  expect(knowledgeController.list).not.toHaveBeenCalled();
});
