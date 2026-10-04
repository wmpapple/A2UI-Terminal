import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from './i18n/I18nProvider';
import { WorkspaceLayout } from './WorkspaceLayout';
import { WorkspacePanelControls } from './WorkspacePanelControls';

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
  it('collapses panels without unmounting drafts and restores their widths', () => {
    render(
      <I18nProvider>
        <WorkspaceLayout
          collapsible
          left={<input aria-label="file draft" defaultValue="file state" />}
          center={<WorkspacePanelControls />}
          right={<textarea aria-label="AI draft" defaultValue="unsent prompt" />}
        />
      </I18nProvider>
    );
    const draft = screen.getByLabelText('AI draft');
    fireEvent.click(screen.getByRole('button', { name: '收起 AI 栏' }));
    expect(draft).not.toBeVisible();
    expect(draft).toHaveValue('unsent prompt');
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '收起文件栏' }));
    expect(screen.getByLabelText('file draft')).not.toBeVisible();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-layout').style.gridTemplateColumns).toBe(
      'minmax(360px, 1fr)'
    );
    fireEvent.click(screen.getByRole('button', { name: '展开 AI 栏' }));
    fireEvent.click(screen.getByRole('button', { name: '展开文件栏' }));
    expect(screen.getByLabelText('AI draft')).toBe(draft);
    expect(draft).toBeVisible();
    expect(screen.getByTestId('workspace-layout').style.gridTemplateColumns).toContain('230px');
  });

  it('supports sidebar shortcuts without overriding bold or IME input', () => {
    render(
      <I18nProvider>
        <WorkspaceLayout
          collapsible
          left={<div>files</div>}
          center={
            <>
              <WorkspacePanelControls />
              <textarea aria-label="editor draft" />
            </>
          }
          right={<div>assistant</div>}
        />
      </I18nProvider>
    );
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(screen.getByRole('button', { name: '展开文件栏' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('editor draft'), { key: 'b', ctrlKey: true });
    expect(screen.getByRole('button', { name: '展开文件栏' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, shiftKey: true, isComposing: true });
    expect(screen.getByRole('button', { name: '收起 AI 栏' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('button', { name: '展开 AI 栏' })).toBeInTheDocument();
  });

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
