import type { A2uiSurface } from '../../shared/types/domain';
import { errorDetails, findA2uiNode, upsertA2uiSurface } from '../../stores/support';
import type { AppGet, AppSet, AppState } from '../../stores/types';
import { a2uiController } from './a2uiController';

type A2uiActions = Pick<
  AppState,
  | 'setActiveSurface'
  | 'setActiveInspection'
  | 'deleteActiveA2uiSurface'
  | 'deleteRejectedA2uiInspection'
  | 'executeA2uiAction'
  | 'openA2uiTemplate'
>;

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
    set((state) => {
      const inspectionSurfaceId = state.a2uiInspections.find(
        (inspection) => inspection.id === activeInspectionId
      )?.surfaceId;
      const matchingSurfaceId = state.a2uiSurfaces.find(
        (surface) => surface.surfaceId === inspectionSurfaceId
      )?.surfaceId;
      return {
        activeInspectionId,
        activeSurfaceId: matchingSurfaceId ?? state.activeSurfaceId,
        centerView: 'surface',
      };
    }),

  deleteActiveA2uiSurface: async (surfaceId) => {
    const state = get();
    const surface = state.a2uiSurfaces.find(
      (item) => item.surfaceId === (surfaceId ?? state.activeSurfaceId)
    );
    if (!surface || state.a2uiActionLoading) return;
    set({ a2uiActionLoading: true, a2uiNotice: null });
    try {
      if (state.runtimeMode !== 'web-mock') {
        const workspace = state.workspace;
        if (!workspace) return;
        await a2uiController.deleteSurface(workspace.id, surface.surfaceId);
      }
      set((current) => {
        const a2uiSurfaces = current.a2uiSurfaces.filter(
          (item) => item.surfaceId !== surface.surfaceId
        );
        const a2uiInspections = current.a2uiInspections.filter(
          (inspection) => inspection.surfaceId !== surface.surfaceId
        );
        const currentSurfaceStillExists = a2uiSurfaces.some(
          (item) => item.surfaceId === current.activeSurfaceId
        );
        const activeSurfaceId = currentSurfaceStillExists
          ? current.activeSurfaceId
          : (a2uiSurfaces[0]?.surfaceId ?? '');
        const currentInspectionStillExists = a2uiInspections.some(
          (inspection) => inspection.id === current.activeInspectionId
        );
        const activeInspectionId = currentInspectionStillExists
          ? current.activeInspectionId
          : (a2uiInspections.find((inspection) => inspection.surfaceId === activeSurfaceId)?.id ??
            '');
        return {
          a2uiSurfaces,
          a2uiInspections,
          activeSurfaceId,
          activeInspectionId,
          centerView: a2uiSurfaces.length === 0 ? 'editor' : current.centerView,
        };
      });
    } catch (error) {
      set({ a2uiNotice: errorDetails(error).message });
    } finally {
      set({ a2uiActionLoading: false });
    }
  },

  deleteRejectedA2uiInspection: async (inspectionId) => {
    const state = get();
    const inspection = state.a2uiInspections.find(
      (item) => item.id === (inspectionId ?? state.activeInspectionId)
    );
    if (!inspection || inspection.validation.valid || state.a2uiActionLoading) return;
    set({ a2uiActionLoading: true, a2uiNotice: null });
    try {
      if (state.runtimeMode !== 'web-mock') {
        const workspace = state.workspace;
        if (!workspace) return;
        const deleted = await a2uiController.deleteInspection(workspace.id, inspection.id);
        if (!deleted) throw new Error('未找到可删除的失败检查记录');
      }
      set((current) => {
        const a2uiInspections = current.a2uiInspections.filter((item) => item.id !== inspection.id);
        const nextInspection =
          current.activeInspectionId === inspection.id
            ? (a2uiInspections.find((item) => item.surfaceId === current.activeSurfaceId) ??
              a2uiInspections[0])
            : a2uiInspections.find((item) => item.id === current.activeInspectionId);
        const activeSurfaceId = current.a2uiSurfaces.some(
          (surface) => surface.surfaceId === current.activeSurfaceId
        )
          ? current.activeSurfaceId
          : (current.a2uiSurfaces.find((surface) => surface.surfaceId === nextInspection?.surfaceId)
              ?.surfaceId ??
            current.a2uiSurfaces[0]?.surfaceId ??
            '');
        return {
          a2uiInspections,
          activeInspectionId: nextInspection?.id ?? '',
          activeSurfaceId,
          centerView:
            current.a2uiSurfaces.length === 0 && a2uiInspections.length === 0
              ? 'editor'
              : current.centerView,
        };
      });
    } catch (error) {
      set({ a2uiNotice: errorDetails(error).message });
    } finally {
      set({ a2uiActionLoading: false });
    }
  },

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
        pendingDiff: result.review ?? current.pendingDiff,
        centerView: result.review ? 'diff' : current.centerView,
        patchError: result.review ? null : current.patchError,
      }));
    } catch (error) {
      set({ a2uiNotice: errorDetails(error).message });
    } finally {
      if (!stateTarget) set({ a2uiActionLoading: false });
    }
  },

  openA2uiTemplate: async (templateId) => {
    const state = get();
    if (
      state.runtimeMode === 'web-mock' ||
      !state.workspace ||
      !state.activeSessionId ||
      state.a2uiActionLoading
    ) {
      return false;
    }
    set({ a2uiActionLoading: true, a2uiNotice: null });
    try {
      const opened = await a2uiController.openTemplate(
        state.workspace.id,
        templateId,
        state.activeSessionId
      );
      set((current) => ({
        a2uiSurfaces: upsertA2uiSurface(current.a2uiSurfaces, opened.surface),
        activeSurfaceId: opened.surface.surfaceId,
        centerView: 'surface',
        a2uiNotice: '个人模板已重新通过安全校验并打开',
      }));
      return true;
    } catch (error) {
      set({ a2uiNotice: errorDetails(error).message });
      return false;
    } finally {
      set({ a2uiActionLoading: false });
    }
  },
});
