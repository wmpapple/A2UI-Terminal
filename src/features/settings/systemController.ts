import { desktopGateway } from '../../shared/platform/gateway';

export const systemController = {
  exportDiagnostics: () => desktopGateway.exportDiagnostics(),
  clearAllLocalData: (confirmation: string) => desktopGateway.clearAllLocalData(confirmation),
};
