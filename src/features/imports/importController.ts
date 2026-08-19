import { webMockImportGateway } from '../../shared/mock/imports';
import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';
import type { ImportDropOutcome, SetImportDropTargetInput } from '../../shared/types/domain';
import { isImportDropOutcome } from '../../shared/contracts/guards';

const gateway = () => (isWebMock() ? webMockImportGateway : desktopGateway);

export const importController = {
  select: (workspaceId?: string) => gateway().selectImportSources(workspaceId),
  inspect: (batchId: string) => gateway().inspectImportBatch(batchId),
  setDropTarget: (input: SetImportDropTargetInput) => gateway().setImportDropTarget(input),
  listenForDrops: (handler: (outcome: ImportDropOutcome) => void) =>
    gateway().listenImportDropOutcomes((outcome) => {
      if (isImportDropOutcome(outcome)) handler(outcome);
    }),
  selectBrowserDropFallback: (workspaceId?: string) =>
    isWebMock() ? webMockImportGateway.selectImportSources(workspaceId) : Promise.resolve(null),
  confirm: (batchId: string, acceptedItemIds: string[]) =>
    gateway().confirmImport(batchId, acceptedItemIds, true),
  cancel: (batchId: string) => gateway().confirmImport(batchId, [], false),
  listSources: (workspaceId: string) => gateway().listDocumentSources(workspaceId),
  readSource: (sourceId: string) => gateway().readDocumentSource(sourceId),
  revokeSource: (workspaceId: string, sourceId: string) =>
    gateway().revokeDocumentSource(workspaceId, sourceId),
};
