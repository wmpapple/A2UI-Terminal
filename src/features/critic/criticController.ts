import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';
import type { DocumentSnapshot } from '../../shared/types/document';
import type { CriticOptions } from '../../shared/types/critic';
import { criticMock } from './criticMock';
export const criticController = {
  inspect: (snapshot: DocumentSnapshot, options: CriticOptions, workspaceId: string) =>
    isWebMock()
      ? criticMock.inspect(snapshot, options, workspaceId)
      : desktopGateway.inspectDocumentCritic(snapshot.target, options),
  ignore: (reportId: string, findingId: string, ignored: boolean) =>
    isWebMock()
      ? criticMock.ignore(reportId, findingId, ignored)
      : desktopGateway.ignoreCriticFinding(reportId, findingId, ignored),
  resolve: (reportId: string, findingId: string) =>
    isWebMock()
      ? criticMock.resolve(reportId, findingId)
      : desktopGateway.resolveCriticFinding(reportId, findingId),
  plan: (reportId: string, providerId: string) =>
    isWebMock()
      ? criticMock.plan(reportId, providerId)
      : desktopGateway.planDocumentCritic(reportId, providerId),
  confirm: (id: string, sensitive: boolean) =>
    isWebMock() ? criticMock.confirm(id) : desktopGateway.confirmContextManifest(id, sensitive),
  start: (id: string) =>
    isWebMock() ? criticMock.start(id) : desktopGateway.startDocumentCritic(id),
  cancel: (id: string) =>
    isWebMock() ? criticMock.cancel(id) : desktopGateway.cancelDocumentCritic(id),
};
