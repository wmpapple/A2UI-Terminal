import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockA2ui } from '../shared/mock/workspace';
import { desktopApi } from '../shared/platform/desktop';
import { useAppStore } from './useAppStore';

beforeEach(() => {
  vi.restoreAllMocks();
  const first = createMockA2ui();
  const second = {
    surface: { ...first.surface, surfaceId: 'surface-2' },
    inspection: { ...first.inspection, id: 'inspection-2', surfaceId: 'surface-2' },
  };
  useAppStore.setState({
    runtimeMode: 'desktop',
    workspace: {
      id: 'workspace-a2ui',
      name: 'A2UI',
      available: true,
      kind: 'directory',
    },
    a2uiSurfaces: [first.surface, second.surface],
    a2uiInspections: [first.inspection, second.inspection],
    activeSurfaceId: first.surface.surfaceId,
    activeInspectionId: first.inspection.id,
    activeSessionId: 'session-a2ui',
    a2uiActionLoading: false,
    a2uiNotice: null,
    centerView: 'surface',
  });
});

describe('desktop A2UI deletion', () => {
  it('deletes only the confirmed workspace Surface and selects the next history item', async () => {
    const deleteSurface = vi.spyOn(desktopApi, 'deleteA2uiSurface').mockResolvedValue(true);

    await useAppStore.getState().deleteActiveA2uiSurface();

    expect(deleteSurface).toHaveBeenCalledWith('workspace-a2ui', 'web-mock-form');
    expect(useAppStore.getState().a2uiSurfaces.map((surface) => surface.surfaceId)).toEqual([
      'surface-2',
    ]);
    expect(useAppStore.getState().a2uiInspections.map((inspection) => inspection.id)).toEqual([
      'inspection-2',
    ]);
    expect(useAppStore.getState().activeSurfaceId).toBe('surface-2');
    expect(useAppStore.getState().activeInspectionId).toBe('inspection-2');
    expect(useAppStore.getState().centerView).toBe('surface');
  });

  it('retains local history when the native deletion fails', async () => {
    vi.spyOn(desktopApi, 'deleteA2uiSurface').mockRejectedValue({
      code: 'DATABASE_ERROR',
      message: 'delete failed',
    });

    await useAppStore.getState().deleteActiveA2uiSurface();

    expect(useAppStore.getState().a2uiSurfaces).toHaveLength(2);
    expect(useAppStore.getState().a2uiInspections).toHaveLength(2);
    expect(useAppStore.getState().a2uiNotice).toBe('delete failed');
    expect(useAppStore.getState().a2uiActionLoading).toBe(false);
  });

  it('deletes one rejected inspection without deleting its Surface or other records', async () => {
    const rejected = {
      ...useAppStore.getState().a2uiInspections[0],
      id: 'rejected-inspection',
      surfaceId: null,
      validation: {
        ...useAppStore.getState().a2uiInspections[0].validation,
        valid: false,
      },
    };
    useAppStore.setState((state) => ({
      a2uiInspections: [rejected, ...state.a2uiInspections],
      activeInspectionId: rejected.id,
    }));
    const deleteInspection = vi.spyOn(desktopApi, 'deleteA2uiInspection').mockResolvedValue(true);

    await useAppStore.getState().deleteRejectedA2uiInspection();

    expect(deleteInspection).toHaveBeenCalledWith('workspace-a2ui', 'rejected-inspection');
    expect(useAppStore.getState().a2uiSurfaces).toHaveLength(2);
    expect(useAppStore.getState().a2uiInspections.map((item) => item.id)).toEqual([
      'web-mock-inspection',
      'inspection-2',
    ]);
    expect(useAppStore.getState().activeInspectionId).toBe('web-mock-inspection');
    expect(useAppStore.getState().centerView).toBe('surface');
  });

  it('keeps a rejected inspection when native deletion fails', async () => {
    const rejected = {
      ...useAppStore.getState().a2uiInspections[0],
      id: 'rejected-inspection',
      validation: {
        ...useAppStore.getState().a2uiInspections[0].validation,
        valid: false,
      },
    };
    useAppStore.setState((state) => ({
      a2uiInspections: [rejected, ...state.a2uiInspections],
      activeInspectionId: rejected.id,
    }));
    vi.spyOn(desktopApi, 'deleteA2uiInspection').mockRejectedValue({
      code: 'DATABASE_ERROR',
      message: 'inspection delete failed',
    });

    await useAppStore.getState().deleteRejectedA2uiInspection();

    expect(useAppStore.getState().a2uiInspections[0].id).toBe('rejected-inspection');
    expect(useAppStore.getState().a2uiNotice).toBe('inspection delete failed');
    expect(useAppStore.getState().a2uiActionLoading).toBe(false);
  });
});

describe('desktop personal A2UI templates', () => {
  it('opens only the Rust-revalidated Surface returned by the desktop command', async () => {
    const openedSurface = {
      ...createMockA2ui().surface,
      surfaceId: 'personal-safe-template',
      workspaceId: 'workspace-a2ui',
      sessionId: 'session-a2ui',
    };
    const open = vi.spyOn(desktopApi, 'openA2uiTemplate').mockResolvedValue({
      template: {
        id: 'template-1',
        workspaceId: 'workspace-a2ui',
        name: '联系人表单',
        protocolVersion: 'v0.9.1',
        catalogId: 'urn:a2ui-terminal:catalog:basic:v1',
        permissions: [],
        valid: true,
        createdAt: '2026-09-16T00:00:00Z',
        updatedAt: '2026-09-16T00:00:00Z',
      },
      surface: openedSurface,
    });

    const result = await useAppStore.getState().openA2uiTemplate('template-1');

    expect(result).toBe(true);
    expect(open).toHaveBeenCalledWith('workspace-a2ui', 'template-1', 'session-a2ui');
    expect(useAppStore.getState().activeSurfaceId).toBe('personal-safe-template');
    expect(useAppStore.getState().centerView).toBe('surface');
    expect(useAppStore.getState().a2uiNotice).toContain('重新通过安全校验');
  });

  it('does not alter the active Surface when template revalidation fails', async () => {
    vi.spyOn(desktopApi, 'openA2uiTemplate').mockRejectedValue({
      code: 'INVALID_INPUT',
      message: '个人模板已失效，无法安全打开',
    });

    const result = await useAppStore.getState().openA2uiTemplate('template-invalid');

    expect(result).toBe(false);
    expect(useAppStore.getState().activeSurfaceId).toBe('web-mock-form');
    expect(useAppStore.getState().a2uiNotice).toContain('已失效');
  });
});
