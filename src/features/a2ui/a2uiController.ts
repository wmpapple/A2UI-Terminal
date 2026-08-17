import { desktopGateway } from '../../shared/platform/gateway';

export const a2uiController = {
  listHistory: async (workspaceId: string) => {
    const [surfaces, inspections] = await Promise.all([
      desktopGateway.listA2uiSurfaces(workspaceId),
      desktopGateway.listA2uiInspections(workspaceId),
    ]);
    return { surfaces, inspections };
  },
  deleteSurface: (workspaceId: string, surfaceId: string) =>
    desktopGateway.deleteA2uiSurface(workspaceId, surfaceId),
  execute: (request: {
    workspaceId: string;
    surfaceId: string;
    componentId: string;
    eventName: string;
    payload?: unknown;
  }) => desktopGateway.executeA2uiAction(request),
};
