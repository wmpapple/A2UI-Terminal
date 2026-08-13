import type { DocumentPatch } from '../../shared/types/domain';
import { desktopGateway } from '../../shared/platform/gateway';

export const reviewController = {
  apply: (request: {
    workspaceId: string;
    patch: DocumentPatch;
    selectedChangeIds: string[];
    sessionId?: string;
    assistantMessageId?: string;
  }) => desktopGateway.applyDocumentPatch(request),
  undo: (workspaceId: string, operationId: string) =>
    desktopGateway.undoDocumentPatch(workspaceId, operationId),
};
