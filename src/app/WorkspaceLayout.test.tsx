import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from './i18n/I18nProvider';
import { WorkspaceLayout } from './WorkspaceLayout';

const renderLayout = () =>
  render(
    <I18nProvider>
      <WorkspaceLayout
        left={<div>files</div>}
        center={<div>editor</div>}
        right={<div>assistant</div>}
      />
    </I18nProvider>
  );

const setWorkspaceWidth = (width: number) => {
  const workspace = screen.getByTestId('workspace-layout');
  Object.defineProperty(workspace, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width, height: 800, top: 0, right: width, bottom: 800, left: 0 }),
  });
  return workspace;
};

const firePointer = (target: Element | Window, type: string, clientX: number) =>
  fireEvent(target, new MouseEvent(type, { bubbles: true, clientX }));

beforeEach(() => localStorage.clear());

describe('WorkspaceLayout', () => {
  it('resizes the file column by dragging and persists the result', () => {
    renderLayout();
    const workspace = setWorkspaceWidth(1200);
    const [fileSeparator] = screen.getAllByRole('separator');

    firePointer(fileSeparator, 'pointerdown', 230);
    firePointer(window, 'pointermove', 330);
    firePointer(window, 'pointerup', 330);

    expect(workspace.style.gridTemplateColumns).toContain('330px');
    expect(JSON.parse(localStorage.getItem('a2ui.workspace.column-widths.v1') ?? '{}')).toEqual({
      left: 330,
      right: 360,
    });
  });

  it('supports keyboard resizing and restores saved widths', () => {
    localStorage.setItem(
      'a2ui.workspace.column-widths.v1',
      JSON.stringify({ left: 300, right: 320 })
    );
    renderLayout();
    const workspace = setWorkspaceWidth(1200);
    const [, assistantSeparator] = screen.getAllByRole('separator');

    expect(workspace.style.gridTemplateColumns).toContain('300px');
    expect(workspace.style.gridTemplateColumns).toContain('320px');

    fireEvent.keyDown(assistantSeparator, { key: 'ArrowLeft' });

    expect(workspace.style.gridTemplateColumns).toContain('336px');
    expect(JSON.parse(localStorage.getItem('a2ui.workspace.column-widths.v1') ?? '{}')).toEqual({
      left: 300,
      right: 336,
    });
  });

  it('keeps the editor and assistant columns above their minimum widths', () => {
    renderLayout();
    const workspace = setWorkspaceWidth(1000);
    const [fileSeparator] = screen.getAllByRole('separator');

    firePointer(fileSeparator, 'pointerdown', 230);
    firePointer(window, 'pointermove', 2000);
    firePointer(window, 'pointerup', 2000);

    expect(workspace.style.gridTemplateColumns).toContain('344px');
    expect(workspace.style.gridTemplateColumns).toContain('minmax(360px, 1fr)');
    expect(workspace.style.gridTemplateColumns).toContain('280px');
  });

  it('uses the same editor and assistant nodes without rendering the file panel in simple mode', () => {
    render(
      <I18nProvider>
        <WorkspaceLayout
          showLeftPanel={false}
          left={<div>files</div>}
          center={<div>editor</div>}
          right={<div>assistant</div>}
        />
      </I18nProvider>
    );

    expect(screen.queryByText('files')).not.toBeInTheDocument();
    expect(screen.getByText('editor')).toBeInTheDocument();
    expect(screen.getByText('assistant')).toBeInTheDocument();
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });
});
