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
});
