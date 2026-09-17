import { desktopGateway } from '../../shared/platform/gateway';

export const systemController = {
  exportDiagnostics: () => desktopGateway.exportDiagnostics(),
  clearAllLocalData: (confirmation: string) => desktopGateway.clearAllLocalData(confirmation),
  getTelemetrySettings: () => desktopGateway.getTelemetrySettings(),
  setTelemetrySettings: (enabled: boolean, dismissInvitation = false) =>
    desktopGateway.setTelemetrySettings({ enabled, dismissInvitation }),
  exportEventDictionary: () => desktopGateway.exportEventDictionary(),
};
