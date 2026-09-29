import { desktopGateway } from '../../shared/platform/gateway';

export const semanticSearchController = {
  listProviderConfigs: desktopGateway.listProviderConfigs,
  getSemanticConfig: desktopGateway.getSemanticConfig,
  planSemanticSearch: desktopGateway.planSemanticSearch,
  stepSemanticSearch: desktopGateway.stepSemanticSearch,
  cancelSemanticSearch: desktopGateway.cancelSemanticSearch,
  searchAuthorizedContent: desktopGateway.searchAuthorizedContent,
};
