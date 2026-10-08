import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import type { SceneToolListItem } from '../../shared/types/sceneTool';
import { useAppStore } from '../../stores/useAppStore';
import { MySceneTools } from './MySceneTools';
import { sceneToolController } from './sceneToolController';
import { sceneTools, useSceneToolStore } from './sceneToolStore';

afterEach(() => {
  vi.restoreAllMocks();
  useSceneToolStore.setState({ entries: {} });
});

const rows = [
  {
    id: 'linked',
    title: '发布检查表',
    bindingTitle: 'PRD.md',
    updatedAt: new Date().toISOString(),
    publication: {
      resultId: 'result',
      revisionId: 'revision',
      title: '发布报告',
      revisionNumber: 1,
      synced: true,
    },
  } as SceneToolListItem,
  {
    id: 'standalone',
    title: '发布检查表',
    bindingTitle: null,
    updatedAt: new Date().toISOString(),
    publication: null,
  } as SceneToolListItem,
];

it('shows searchable two-line identities and filters tools', async () => {
  useAppStore.setState({ runtimeMode: 'desktop' });
  vi.spyOn(sceneToolController, 'list').mockResolvedValue(rows);
  const { container, rerender } = render(
    <I18nProvider>
      <MySceneTools onOpenResult={vi.fn()} activeId="linked" />
    </I18nProvider>
  );
  expect(await screen.findByText(/PRD.md · 成果 Rev 1 · 今天/)).toBeVisible();
  expect(screen.getByText(/未关联 · 今天/)).toBeVisible();
  expect(container.querySelector('[data-active="true"]')).toBeTruthy();
  expect(screen.getByRole('heading', { name: /工具/ })).toHaveTextContent('工具2');
  expect(screen.getByRole('button', { name: '全部' })).toHaveTextContent('全部2');
  expect(screen.getByRole('button', { name: '已关联' })).toHaveTextContent('已关联1');
  expect(screen.getByRole('button', { name: '未关联' })).toHaveTextContent('未关联1');
  expect(screen.getByRole('button', { name: '已有成果' })).toHaveTextContent('已有成果1');

  fireEvent.click(screen.getByRole('button', { name: '未关联' }));
  expect(screen.getAllByRole('button', { name: '发布检查表' })).toHaveLength(1);
  expect(screen.getByText(/未关联 · 今天/)).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: '全部' }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索工具' }), {
    target: { value: 'PRD' },
  });
  expect(screen.getAllByRole('button', { name: '发布检查表' })).toHaveLength(1);
  expect(screen.getByText(/PRD.md/)).toBeVisible();

  rerender(
    <I18nProvider>
      <MySceneTools onOpenResult={vi.fn()} activeId={null} />
    </I18nProvider>
  );
  expect(container.querySelector('[data-active="true"]')).toBeNull();
});

it('shows a pending result when the published tool has newer local changes', async () => {
  useAppStore.setState({ runtimeMode: 'desktop' });
  useSceneToolStore.setState({
    entries: {
      linked: {
        view: null,
        data: {},
        dirty: true,
        saving: false,
        error: null,
        conflict: false,
      },
    },
  });
  vi.spyOn(sceneToolController, 'list').mockResolvedValue(rows);
  render(
    <I18nProvider>
      <MySceneTools onOpenResult={vi.fn()} />
    </I18nProvider>
  );
  expect(await screen.findByText(/PRD.md · 成果待更新 · 今天/)).toBeVisible();
});

it('keeps row actions in the more menu and confirms deletion', async () => {
  useAppStore.setState({ runtimeMode: 'desktop' });
  vi.spyOn(sceneToolController, 'list').mockResolvedValue(rows);
  vi.spyOn(sceneTools, 'delete').mockResolvedValue(true);
  const deleted = vi.fn();
  const manage = vi.fn();
  render(
    <I18nProvider>
      <MySceneTools onOpenResult={vi.fn()} onDeleted={deleted} onManage={manage} />
    </I18nProvider>
  );
  await screen.findByText(/PRD.md/);
  expect(screen.queryByRole('button', { name: /删除工具：发布检查表/ })).not.toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('button', { name: '工具操作：发布检查表' })[0]);
  fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }));
  expect(manage).toHaveBeenCalledWith('linked', 'rename');

  fireEvent.click(screen.getAllByRole('button', { name: '工具操作：发布检查表' })[0]);
  fireEvent.click(await screen.findByRole('menuitem', { name: '删除工具' }));
  const dialog = await screen.findByRole('dialog', { name: '删除工具“发布检查表”？' });
  fireEvent.click(within(dialog).getByRole('button', { name: /删\s*除/ }));
  await waitFor(() => expect(sceneTools.delete).toHaveBeenCalledWith('linked'));
  expect(deleted).toHaveBeenCalledWith('linked');
});
