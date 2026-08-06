import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { WorkspaceSidebar } from './WorkspaceSidebar';

describe('WorkspaceSidebar', () => {
  it('renders the mock project files and disclosure', () => {
    render(
      <I18nProvider>
        <WorkspaceSidebar />
      </I18nProvider>
    );
    expect(screen.getByRole('treeitem', { name: /README\.md/i })).toBeInTheDocument();
    expect(screen.getByText(/不会读取或写入本地文件/)).toBeInTheDocument();
  });
});
