import { desktopGateway } from '../../shared/platform/gateway';

export const a2uiController = {
  getCapabilities: () => desktopGateway.getA2uiCapabilities(),
  listHistory: async (workspaceId: string) => {
    const [surfaces, inspections] = await Promise.all([
      desktopGateway.listA2uiSurfaces(workspaceId),
      desktopGateway.listA2uiInspections(workspaceId),
    ]);
    return { surfaces, inspections };
  },
  deleteSurface: (workspaceId: string, surfaceId: string) =>
    desktopGateway.deleteA2uiSurface(workspaceId, surfaceId),
  deleteInspection: (workspaceId: string, inspectionId: string) =>
    desktopGateway.deleteA2uiInspection(workspaceId, inspectionId),
  execute: (request: {
    workspaceId: string;
    surfaceId: string;
    componentId: string;
    eventName: string;
    payload?: unknown;
  }) => desktopGateway.executeA2uiAction(request),
};
