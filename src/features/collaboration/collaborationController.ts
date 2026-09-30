import { desktopGateway } from '../../shared/platform/gateway';
import type { CreateShareInput, SaveFeedbackInput } from '../../shared/types/collaboration';
export const collaborationController = {
  overview: (resultId?: string) => desktopGateway.collaborationOverview(resultId),
  rename: (name: string) => desktopGateway.collaborationRename(name),
  share: (input: CreateShareInput) => desktopGateway.collaborationShare(input),
  revoke: (id: string) => desktopGateway.collaborationRevoke(id),
  inbox: (id: string) => desktopGateway.collaborationInbox(id),
  feedback: (input: SaveFeedbackInput) => desktopGateway.collaborationFeedback(input),
  propose: (id: string) => desktopGateway.collaborationPropose(id),
  import: () => desktopGateway.collaborationImport(),
  export: (id: string, feedback: boolean) => desktopGateway.collaborationExport(id, feedback),
};
