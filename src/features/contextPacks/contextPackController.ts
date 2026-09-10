import { webMockImportGateway } from '../../shared/mock/imports';
import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';
import type { CreateContextPackInput } from '../../shared/types/domain';

const gateway = () => (isWebMock() ? webMockImportGateway : desktopGateway);

export const contextPackController = {
  list: (workspaceId: string) => gateway().listContextPacks(workspaceId),
  create: (input: CreateContextPackInput) => gateway().createContextPack(input),
  delete: (workspaceId: string, packId: string) => gateway().deleteContextPack(workspaceId, packId),
};
