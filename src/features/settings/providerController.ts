import type { ProviderConfig } from '../../shared/types/domain';
import { desktopGateway } from '../../shared/platform/gateway';

export const providerController = {
  list: () => desktopGateway.listProviderConfigs(),
  save: (config: ProviderConfig, secret?: string) =>
    desktopGateway.saveProviderConfig(config, secret),
  select: (providerId: string) => desktopGateway.setActiveProvider(providerId),
  deleteKey: (providerId: string) => desktopGateway.deleteProviderSecret(providerId),
  test: (providerId: string) => desktopGateway.testProviderConnection(providerId),
};
