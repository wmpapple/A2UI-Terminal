import { useAppStore } from '../../stores/useAppStore';

export function openAssistantSurface(messageId: string, failed: boolean) {
  const state = useAppStore.getState();
  if (failed) {
    const inspection = state.a2uiInspections.find((item) => item.messageId === messageId);
    if (inspection) {
      state.setActiveInspection(inspection.id);
      return;
    }
  } else {
    const surface = state.a2uiSurfaces.find((item) => item.messageId === messageId);
    if (surface) {
      state.setActiveSurface(surface.surfaceId);
      return;
    }
  }
  state.setCenterView('surface');
}
