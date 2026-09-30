import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import { desktopGateway } from '../../shared/platform/gateway';
import { useAppStore } from '../../stores/useAppStore';
import type { SceneToolView } from '../../shared/types/sceneTool';
import { SceneTemplateCards } from './SceneTemplateCards';

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({ runtimeMode: 'desktop' });
  vi.spyOn(desktopGateway, 'listToolBindingTargets').mockResolvedValue([]);
  vi.spyOn(desktopGateway, 'listSceneTemplates').mockResolvedValue([
    {
      id: 'publish',
      name: '发布检查表',
      description: '检查发布准备',
      itemLabel: '检查项',
      defaultItems: ['标题', '来源'],
      maxItems: 20,
      bindingPolicy: 'optional',
    },
  ]);
});
describe('scene template creation', () => {
  it('opens simple tools immediately using default fields', async () => {
    vi.mocked(desktopGateway.listSceneTemplates).mockResolvedValue([
      {
        id: 'interview',
        name: '采访提纲',
        description: '',
        itemLabel: '问题',
        defaultItems: ['背景'],
        maxItems: 5,
        bindingPolicy: 'optional',
      },
    ]);
    const create = vi
      .spyOn(desktopGateway, 'createSceneTool')
      .mockResolvedValue({ result: { id: 'direct-tool' } } as SceneToolView);
    const open = vi.fn();
    render(
      <I18nProvider>
        <SceneTemplateCards onOpenResult={open} />
      </I18nProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: '使用模板' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('direct-tool'));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ items: ['背景'] }), {
      type: 'none',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /自定义/ })).toBeInTheDocument();
    expect(screen.queryByText('可独立使用，也可关联对象')).not.toBeInTheDocument();
    expect(screen.queryByText(/选择模板即可在本机填写/)).not.toBeInTheDocument();
  });
  it('requires a target only when a target scope is chosen and supports the current document', async () => {
    const binding = {
      type: 'document',
      target: { kind: 'result', resultId: 'current-document' },
    } as const;
    const create = vi
      .spyOn(desktopGateway, 'createSceneTool')
      .mockResolvedValue({ result: { id: 'bound-tool' } } as SceneToolView);
    render(
      <I18nProvider>
        <SceneTemplateCards currentBinding={binding} onOpenResult={vi.fn()} />
      </I18nProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: /自定义/ }));
    fireEvent.click(screen.getByRole('radio', { name: '从工作区选择' }));
    expect(screen.getByRole('button', { name: '创建工具' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '当前打开的文档' }));
    fireEvent.click(screen.getByRole('button', { name: '创建工具' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.anything(), binding));
  });
  it('creates a publication checklist without any document', async () => {
    const create = vi
      .spyOn(desktopGateway, 'createSceneTool')
      .mockResolvedValue({ result: { id: 'standalone' } } as SceneToolView);
    render(
      <I18nProvider>
        <SceneTemplateCards onOpenResult={vi.fn()} />
      </I18nProvider>
    );
    expect(await screen.findByRole('region', { name: '推荐模板' })).toBeVisible();
    expect(screen.getAllByText('文档').length).toBeGreaterThan(0);
    expect(screen.getAllByText('可独立').length).toBeGreaterThan(0);
    expect(screen.queryByText('可关联')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '立即使用' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ templateId: 'publish' }), {
        type: 'none',
      })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /自定义/ })).toBeInTheDocument();
  });
  it('shows one configurable recommendation and no more than two tags per standard card', async () => {
    vi.mocked(desktopGateway.listSceneTemplates).mockResolvedValue([
      {
        id: 'publish',
        name: '发布检查表',
        description: '检查发布准备',
        itemLabel: '检查项',
        defaultItems: ['标题'],
        maxItems: 20,
        bindingPolicy: 'optional',
      },
      {
        id: 'interview',
        name: '采访提纲',
        description: '整理采访问题',
        itemLabel: '问题',
        defaultItems: ['背景'],
        maxItems: 5,
        bindingPolicy: 'optional',
      },
    ]);
    render(
      <I18nProvider>
        <SceneTemplateCards recommendedTemplateId="interview" onOpenResult={vi.fn()} />
      </I18nProvider>
    );
    const recommendations = await screen.findAllByRole('region', { name: '推荐模板' });
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toHaveAttribute('data-template-id', 'interview');
    expect(within(recommendations[0]).getByRole('heading', { name: '采访提纲' })).toBeVisible();
    const builtins = screen.getByRole('region', { name: '内置场景工具模板' });
    within(builtins)
      .getAllByLabelText('适用范围')
      .forEach((scope) => expect(scope.querySelectorAll('.ant-tag').length).toBeLessThanOrEqual(2));
  });
  it('creates from real custom input and opens the persisted Result', async () => {
    const create = vi
      .spyOn(desktopGateway, 'createSceneTool')
      .mockResolvedValue({ result: { id: 'new-tool' } } as SceneToolView);
    const opened = vi.fn();
    render(
      <I18nProvider>
        <SceneTemplateCards
          initialBinding={{ type: 'document', target: { kind: 'result', resultId: 'doc' } }}
          onOpenResult={opened}
        />
      </I18nProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: /自定义/ }));
    fireEvent.change(screen.getByLabelText('工具名称'), { target: { value: '真实发布任务' } });
    fireEvent.change(screen.getByLabelText('检查项'), {
      target: { value: '数据未获批准\n核对来源' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建工具' }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith('new-tool'));
    expect(create).toHaveBeenCalledWith(
      {
        templateId: 'publish',
        title: '真实发布任务',
        items: ['数据未获批准', '核对来源'],
        locale: 'zh-CN',
      },
      { type: 'document', target: { kind: 'result', resultId: 'doc' } }
    );
    expect(screen.queryByText(/Catalog|Surface|Protocol/)).not.toBeInTheDocument();
  });
  it('blocks oversized items and duplicate submission while creating', async () => {
    vi.spyOn(desktopGateway, 'createSceneTool').mockImplementation(() => new Promise(() => {}));
    render(
      <I18nProvider>
        <SceneTemplateCards
          initialBinding={{ type: 'document', target: { kind: 'result', resultId: 'doc' } }}
          onOpenResult={vi.fn()}
        />
      </I18nProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: /自定义/ }));
    fireEvent.change(screen.getByLabelText('检查项'), { target: { value: '长'.repeat(25) } });
    expect(screen.getByRole('button', { name: '创建工具' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('检查项'), { target: { value: '来源' } });
    const createButton = screen.getByRole('button', { name: '创建工具' });
    fireEvent.click(createButton);
    fireEvent.click(createButton);
    expect(desktopGateway.createSceneTool).toHaveBeenCalledTimes(1);
  });
  it('does not pretend web mock is durable storage', () => {
    useAppStore.setState({ runtimeMode: 'web-mock' });
    render(
      <I18nProvider>
        <SceneTemplateCards onOpenResult={vi.fn()} />
      </I18nProvider>
    );
    expect(screen.getByText('请在桌面程序中创建和保存场景工具。')).toBeInTheDocument();
    expect(desktopGateway.listSceneTemplates).not.toHaveBeenCalled();
  });
});
