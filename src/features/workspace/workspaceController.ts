import { desktopGateway } from '../../shared/platform/gateway';

export const workspaceController = {
  select: () => desktopGateway.selectWorkspace(),
  selectContextFiles: (workspaceId?: string) => desktopGateway.selectContextFiles(workspaceId),
  listRecent: () => desktopGateway.listRecentWorkspaces(),
  restore: (workspaceId: string) => desktopGateway.restoreWorkspace(workspaceId),
  remove: (workspaceId: string) => desktopGateway.removeWorkspace(workspaceId),
  listFiles: (workspaceId: string) => desktopGateway.listWorkspaceFiles(workspaceId),
  readFile: (workspaceId: string, path: string) =>
    desktopGateway.readWorkspaceFile(workspaceId, path),
  listRecoveryDrafts: (workspaceId: string) => desktopGateway.listRecoveryDrafts(workspaceId),
  saveDraft: (workspaceId: string, path: string, content: string, baseHash: string) =>
    desktopGateway.saveWorkspaceDraft(workspaceId, path, content, baseHash),
  saveFile: (workspaceId: string, path: string, content: string, baseHash: string) =>
    desktopGateway.saveWorkspaceFile(workspaceId, path, content, baseHash),
  saveContextFile: (sourceId: string, content: string, baseHash: string) =>
    desktopGateway.saveContextFile(sourceId, content, baseHash),
  discardDraft: (workspaceId: string, path: string) =>
    desktopGateway.discardWorkspaceDraft(workspaceId, path),
  listVersions: (workspaceId: string, path: string) =>
    desktopGateway.listDocumentVersions(workspaceId, path),
  readVersion: (workspaceId: string, path: string, versionId: string) =>
    desktopGateway.readDocumentVersion(workspaceId, path, versionId),
  restoreVersion: (workspaceId: string, path: string, versionId: string, baseHash: string) =>
    desktopGateway.restoreDocumentVersion(workspaceId, path, versionId, baseHash),
};
