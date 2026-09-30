import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import { desktopGateway } from '../../shared/platform/gateway';
import type { A2uiTemplate } from '../../shared/types/domain';
import type { SceneToolView } from '../../shared/types/sceneTool';
import { useAppStore } from '../../stores/useAppStore';
import { SavedSceneTemplates } from './SavedSceneTemplates';

const template: A2uiTemplate = {
  id: 'saved-publish',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  name: '正式发布复核',
  protocolVersion: 'v0.9.1',
  catalogId: 'urn:a2ui-terminal:catalog:basic:v1',
  permissions: [],
  valid: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  sourceTemplateId: 'publish',
};

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({ runtimeMode: 'desktop' });
  vi.spyOn(desktopGateway, 'listToolBindingTargets').mockResolvedValue([]);
});

describe('SavedSceneTemplates', () => {
  it('explains how to create the first personal template and opens My Tools', async () => {
    vi.spyOn(desktopGateway, 'listA2uiTemplates').mockResolvedValue([]);
    const openTools = vi.fn();
    render(
      <I18nProvider>
        <SavedSceneTemplates onOpenResult={vi.fn()} onOpenMyTools={openTools} />
      </I18nProvider>
    );
    expect(await screen.findByText('还没有个人模板')).toBeVisible();
    expect(screen.getByText('在“我的工具”中选择“保存为个人模板”后，会显示在这里。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '前往我的工具' }));
    expect(openTools).toHaveBeenCalledOnce();
  });

  it('distinguishes a personal template, shows its source and creates a clean tool', async () => {
    vi.spyOn(desktopGateway, 'listA2uiTemplates').mockResolvedValue([template]);
    vi.spyOn(desktopGateway, 'openSceneTemplate').mockResolvedValue({
      result: { id: 'new-tool' },
    } as SceneToolView);
    const opened = vi.fn();
    render(
      <I18nProvider>
        <SavedSceneTemplates onOpenResult={opened} onOpenMyTools={vi.fn()} />
      </I18nProvider>
    );
    expect(await screen.findByText('正式发布复核')).toBeVisible();
    expect(screen.getByText('基于：')).toHaveTextContent('发布检查表');
    expect(screen.getByText(/我的模板 · 今天更新/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '使用模板' }));
    fireEvent.click(screen.getByRole('button', { name: '创建工具' }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith('new-tool'));
    expect(desktopGateway.openSceneTemplate).toHaveBeenCalledWith(template.id, { type: 'none' });
  });
});
