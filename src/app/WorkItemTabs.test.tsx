import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { WorkItemTabs } from './WorkItemTabs';

it('opens and closes mixed work items without knowing their editor implementation', () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const items = [
    { id: 'paper.md', type: 'document' as const, title: 'paper.md', status: 'dirty' as const },
    { id: 'review', type: 'tool' as const, title: '论文评审器', status: 'saved' as const },
    { id: 'result', type: 'result' as const, title: '评审结果', status: 'conflict' as const },
  ];
  render(<WorkItemTabs items={items} activeId="review" onSelect={onSelect} onClose={onClose} />);
  expect(screen.getByRole('tab', { name: '论文评审器' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('Unsaved')).toBeInTheDocument();
  expect(screen.getByLabelText('Conflict')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'paper.md' }));
  expect(onSelect).toHaveBeenCalledWith(items[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Close 论文评审器' }));
  expect(onClose).toHaveBeenCalledWith(items[1]);
});
