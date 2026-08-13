import type { A2uiSurface } from '../../shared/types/domain';
import { errorDetails, findA2uiNode, upsertA2uiSurface } from '../../stores/support';
import type { AppGet, AppSet, AppState } from '../../stores/types';
import { a2uiController } from './a2uiController';

type A2uiActions = Pick<AppState, 'setActiveSurface' | 'setActiveInspection' | 'executeA2uiAction'>;

export const createA2uiStore = (set: AppSet, get: AppGet): A2uiActions => ({
  setActiveSurface: (activeSurfaceId) =>
    set((state) => ({
      activeSurfaceId,
      activeInspectionId:
        state.a2uiInspections.find((inspection) => inspection.surfaceId === activeSurfaceId)?.id ??
        state.activeInspectionId,
      centerView: 'surface',
    })),

  setActiveInspection: (activeInspectionId) =>
    set((state) => ({
      activeInspectionId,
      activeSurfaceId:
        state.a2uiInspections.find((inspection) => inspection.id === activeInspectionId)
          ?.surfaceId ?? state.activeSurfaceId,
      centerView: 'surface',
    })),

  executeA2uiAction: async (componentId, eventName, payload) => {
    const state = get();
    const surface = state.a2uiSurfaces.find((item) => item.surfaceId === state.activeSurfaceId);
    if (!surface) return;
    const action = findA2uiNode(surface.root, componentId)?.actions[eventName];
    const stateTarget =
      action?.type === 'set_state' && typeof action.target === 'string' ? action.target : null;
    set((current) => ({
      a2uiActionLoading: stateTarget ? current.a2uiActionLoading : true,
      a2uiNotice: null,
      a2uiSurfaces: stateTarget
        ? current.a2uiSurfaces.map((item) =>
            item.surfaceId === surface.surfaceId
              ? { ...item, data: { ...item.data, [stateTarget]: payload } }
              : item
          )
        : current.a2uiSurfaces,
    }));
    try {
      if (state.runtimeMode === 'web-mock') {
        const node = findA2uiNode(surface.root, componentId);
        const action = node?.actions[eventName];
        const decision = action
          ? action.type === 'request_patch'
            ? 'review_required'
            : 'allowed'
          : 'denied';
        const target = action?.target;
        const next: A2uiSurface = {
          ...surface,
          data:
            action?.type === 'set_state' && target
              ? { ...surface.data, [target]: payload }
              : surface.data,
          events: [
            {
              id: crypto.randomUUID(),
              componentId,
              eventName,
              actionType: action?.type ?? 'undeclared',
              risk:
                decision === 'denied' ? 'high' : decision === 'review_required' ? 'medium' : 'low',
              decision,
              payload,
              durationMs: 1,
              createdAt: new Date().toISOString(),
            },
            ...surface.events,
          ],
        };
        set((current) => ({
          a2uiSurfaces: upsertA2uiSurface(current.a2uiSurfaces, next),
          a2uiNotice:
            decision === 'review_required'
              ? '文件操作必须进入 Diff 审阅'
              : decision === 'denied'
                ? '未声明的 Action 已拒绝'
                : 'Action 已记录',
        }));
        return;
      }
      const workspace = state.workspace;
      if (!workspace) return;
      const result = await a2uiController.execute({
        workspaceId: workspace.id,
        surfaceId: surface.surfaceId,
        componentId,
        eventName,
        payload,
      });
      set((current) => ({
        a2uiSurfaces: upsertA2uiSurface(
          current.a2uiSurfaces,
          stateTarget
            ? {
                ...result.surface,
                data: {
                  ...result.surface.data,
                  ...(current.a2uiSurfaces.find(
                    (item) => item.surfaceId === result.surface.surfaceId
                  )?.data ?? {}),
                },
              }
            : result.surface
        ),
        a2uiNotice: result.message,
        centerView:
          result.decision === 'review_required' && current.pendingDiff
            ? 'diff'
            : current.centerView,
      }));
    } catch (error) {
      set({ a2uiNotice: errorDetails(error).message });
    } finally {
      if (!stateTarget) set({ a2uiActionLoading: false });
    }
  },
});
