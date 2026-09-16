import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { createMockA2ui } from '../../../shared/mock/workspace';
import { desktopApi } from '../../../shared/platform/desktop';
import type { A2uiTemplate } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { PersonalSurfaceTemplates } from './PersonalSurfaceTemplates';

const template: A2uiTemplate = {
  id: 'template-1',
  workspaceId: 'workspace-template',
  name: '联系人表单',
  protocolVersion: 'v0.9.1',
  catalogId: 'urn:a2ui-terminal:catalog:basic:v1',
  permissions: [
    {
      actionType: 'set_state',
      risk: 'low',
      decision: 'allowed',
      description: '可在本机修改界面字段',
    },
  ],
  valid: true,
  createdAt: '2026-09-16T00:00:00Z',
  updatedAt: '2026-09-16T00:00:00Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({
    runtimeMode: 'desktop',
    workspace: {
      id: 'workspace-template',
      name: 'Templates',
      available: true,
      kind: 'directory',
    },
    activeSessionId: 'session-template',
    a2uiSurfaces: [],
    a2uiActionLoading: false,
    a2uiNotice: null,
  });
});

describe('PersonalSurfaceTemplates', () => {
  it('explains the safety boundary and opens the revalidated Surface', async () => {
    vi.spyOn(desktopApi, 'listA2uiTemplates').mockResolvedValue([template]);
    const surface = {
      ...createMockA2ui().surface,
      surfaceId: 'personal-template-opened',
      workspaceId: 'workspace-template',
      sessionId: 'session-template',
    };
    vi.spyOn(desktopApi, 'openA2uiTemplate').mockResolvedValue({ template, surface });
    const onOpened = vi.fn();

    render(
      <I18nProvider>
        <PersonalSurfaceTemplates onOpened={onOpened} />
      </I18nProvider>
    );

    expect(await screen.findByText('联系人表单')).toBeInTheDocument();
    expect(screen.getByText(/每次打开都会重新检查协议版本/)).toBeInTheDocument();
    expect(screen.getByText('可在本机修改界面字段')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /安全打开/ }));

    await waitFor(() => expect(onOpened).toHaveBeenCalledOnce());
    expect(useAppStore.getState().activeSurfaceId).toBe('personal-template-opened');
  });

  it('shows an invalid template but disables opening it', async () => {
    vi.spyOn(desktopApi, 'listA2uiTemplates').mockResolvedValue([
      { ...template, id: 'invalid', valid: false, invalidReason: 'Catalog 版本已不受支持' },
    ]);

    render(
      <I18nProvider>
        <PersonalSurfaceTemplates onOpened={vi.fn()} />
      </I18nProvider>
    );

    expect(await screen.findByText('Catalog 版本已不受支持')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /安全打开/ })).toBeDisabled();
  });

  it('does not expose the previous workspace templates while the next workspace loads', async () => {
    let resolveOther!: (templates: A2uiTemplate[]) => void;
    vi.spyOn(desktopApi, 'listA2uiTemplates').mockImplementation((workspaceId) =>
      workspaceId === 'workspace-template'
        ? Promise.resolve([template])
        : new Promise((resolve) => {
            resolveOther = resolve;
          })
    );

    render(
      <I18nProvider>
        <PersonalSurfaceTemplates onOpened={vi.fn()} />
      </I18nProvider>
    );
    expect(await screen.findByText('联系人表单')).toBeInTheDocument();

    act(() => {
      useAppStore.setState({
        workspace: {
          id: 'workspace-other',
          name: 'Other',
          available: true,
          kind: 'directory',
        },
      });
    });

    await waitFor(() =>
      expect(desktopApi.listA2uiTemplates).toHaveBeenCalledWith('workspace-other')
    );
    expect(screen.queryByText('联系人表单')).not.toBeInTheDocument();

    await act(async () => resolveOther([]));
    expect(await screen.findByText(/还没有个人交互模板/)).toBeInTheDocument();
  });
});
