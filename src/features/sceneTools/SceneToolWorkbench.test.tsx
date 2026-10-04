import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import { createMockA2ui } from '../../shared/mock/workspace';
import type { ResultDocument } from '../../shared/types/domain';
import type { SceneToolView } from '../../shared/types/sceneTool';
import { useResultStore } from '../results/resultStore';
import { resultController } from '../results/resultController';
import { sceneTools, useSceneToolStore } from './sceneToolStore';
import { SceneToolWorkbench } from './SceneToolWorkbench';

vi.mock('./ToolBindingPanel', () => ({ ToolBindingPanel: () => null }));
vi.mock('../a2ui/runtime/A2uiRuntime', () => ({ A2uiRuntime: () => null }));
vi.mock('../results/components/ExportResultModal', () => ({
  ExportResultModal: () => <div>Export ready</div>,
}));

afterEach(() => vi.restoreAllMocks());

it('saving and exporting a tool preserves the file-side document and unsaved draft', async () => {
  const original = { result: { id: 'document' }, content: 'saved' } as ResultDocument;
  useResultStore.setState({
    activeDocument: original,
    draftContent: 'human draft',
    saveStatus: 'dirty',
  });
  const view: SceneToolView = {
    result: {
      id: 'tool',
      title: 'Tool',
      updatedAt: new Date().toISOString(),
    } as SceneToolView['result'],
    templateId: 'collect',
    stateHash: 'hash',
    surface: { ...createMockA2ui().surface, surfaceId: 'scene-tool', data: {} },
  };
  useSceneToolStore.setState({
    entries: {
      tool: { view, data: {}, dirty: false, saving: false, conflict: false, error: null },
    },
  });
  vi.spyOn(sceneTools, 'load').mockResolvedValue();
  vi.spyOn(sceneTools, 'save').mockResolvedValue(true);
  vi.spyOn(resultController, 'open').mockResolvedValue({
    result: { id: 'tool' },
  } as ResultDocument);
  render(
    <I18nProvider>
      <SceneToolWorkbench resultId="tool" onOpenResult={vi.fn()} onDeleted={vi.fn()} />
    </I18nProvider>
  );
  expect(screen.queryByRole('button', { name: '保存填写' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('已自动保存');
  expect(screen.getByRole('status')).toHaveTextContent(/\d{2}:\d{2}/);
  fireEvent.click(screen.getByRole('button', { name: /导\s*出/ }));
  expect(await screen.findByText('Export ready')).toBeVisible();
  expect(useResultStore.getState()).toMatchObject({
    activeDocument: original,
    draftContent: 'human draft',
    saveStatus: 'dirty',
  });
});

it('shows autosave and publication as explicit states without duplicate navigation', async () => {
  const view: SceneToolView = {
    result: { id: 'tool', title: '王教授访谈' } as SceneToolView['result'],
    templateId: 'interview',
    stateHash: 'hash',
    surface: { ...createMockA2ui().surface, surfaceId: 'scene-tool', data: {} },
    publication: {
      resultId: 'published',
      revisionId: 'revision-2',
      title: '王教授访谈报告',
      revisionNumber: 2,
      synced: true,
    },
  };
  useSceneToolStore.setState({
    entries: {
      tool: { view, data: {}, dirty: false, saving: false, conflict: false, error: null },
    },
  });
  vi.spyOn(sceneTools, 'load').mockResolvedValue();
  render(
    <I18nProvider>
      <SceneToolWorkbench resultId="tool" onOpenResult={vi.fn()} onDeleted={vi.fn()} />
    </I18nProvider>
  );
  expect(screen.getByText(/已关联成果：/)).toHaveTextContent('王教授访谈报告 · Rev 2');
  expect(screen.getByText('已同步到成果 · Rev 2')).toBeVisible();
  expect(screen.queryByRole('button', { name: /已同步到成果/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '我的成果' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存填写' })).not.toBeInTheDocument();

  act(() => {
    useSceneToolStore.setState({
      entries: {
        tool: { view, data: {}, dirty: true, saving: false, conflict: false, error: null },
      },
    });
  });
  expect(screen.getByText('正在保存')).toBeVisible();
  expect(screen.getByRole('button', { name: '更新成果' })).toBeEnabled();
  expect(screen.getByText('● 工具内容有更新')).toBeVisible();

  act(() => {
    useSceneToolStore.setState({
      entries: {
        tool: { view, data: {}, dirty: false, saving: false, conflict: false, error: '磁盘失败' },
      },
    });
  });
  expect(screen.getByText('自动保存失败', { exact: true })).toBeVisible();
});

it('suggests an editable result name for the first publication', async () => {
  const view: SceneToolView = {
    result: { id: 'tool', title: '发布检查表' } as SceneToolView['result'],
    templateId: 'publish',
    stateHash: 'hash',
    surface: { ...createMockA2ui().surface, surfaceId: 'scene-tool', data: {} },
  };
  useSceneToolStore.setState({
    entries: {
      tool: { view, data: {}, dirty: false, saving: false, conflict: false, error: null },
    },
  });
  vi.spyOn(sceneTools, 'load').mockResolvedValue();
  const publish = vi.spyOn(sceneTools, 'publish').mockResolvedValue(true);
  vi.spyOn(useResultStore.getState(), 'loadResults').mockResolvedValue();
  render(
    <I18nProvider>
      <SceneToolWorkbench resultId="tool" onOpenResult={vi.fn()} onDeleted={vi.fn()} />
    </I18nProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: '保存为成果' }));
  const dialog = screen.getByRole('dialog', { name: '保存为成果' });
  expect(screen.getByRole('textbox', { name: '成果名称' })).toHaveValue('发布检查结果');
  fireEvent.change(screen.getByRole('textbox', { name: '成果名称' }), {
    target: { value: 'NLP 复习文档发布检查报告' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '保存为成果' }));
  await waitFor(() => expect(publish).toHaveBeenCalledWith('tool', 'NLP 复习文档发布检查报告'));
});

it('moves secondary tool actions into the more menu', async () => {
  const view: SceneToolView = {
    result: { id: 'tool', title: 'Tool' } as SceneToolView['result'],
    templateId: 'collect',
    stateHash: 'hash',
    surface: { ...createMockA2ui().surface, surfaceId: 'scene-tool', data: {} },
  };
  useSceneToolStore.setState({
    entries: {
      tool: { view, data: {}, dirty: false, saving: false, conflict: false, error: null },
    },
  });
  vi.spyOn(sceneTools, 'load').mockResolvedValue();
  render(
    <I18nProvider>
      <SceneToolWorkbench resultId="tool" onOpenResult={vi.fn()} onDeleted={vi.fn()} />
    </I18nProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: '更多工具操作' }));
  const menuItems = await screen.findAllByRole('menuitem');
  expect(menuItems.map((item) => item.textContent)).toEqual([
    '保存为个人模板',
    '重命名',
    '更换关联对象',
    '重置工具',
    '删除工具',
  ]);
});

it('opens a requested sidebar action after the selected tool is ready', async () => {
  const view: SceneToolView = {
    result: { id: 'tool', title: '王教授访谈' } as SceneToolView['result'],
    templateId: 'interview',
    stateHash: 'hash',
    surface: { ...createMockA2ui().surface, surfaceId: 'scene-tool', data: {} },
  };
  useSceneToolStore.setState({
    entries: {
      tool: { view, data: {}, dirty: false, saving: false, conflict: false, error: null },
    },
  });
  vi.spyOn(sceneTools, 'load').mockResolvedValue();
  const handled = vi.fn();
  render(
    <I18nProvider>
      <SceneToolWorkbench
        resultId="tool"
        requestedAction="rename"
        onRequestedActionHandled={handled}
        onOpenResult={vi.fn()}
        onDeleted={vi.fn()}
      />
    </I18nProvider>
  );
  expect(await screen.findByRole('dialog', { name: '重命名工具' })).toBeInTheDocument();
  expect(screen.getByLabelText('工具名称')).toHaveValue('王教授访谈');
  await waitFor(() => expect(handled).toHaveBeenCalledOnce());
});
