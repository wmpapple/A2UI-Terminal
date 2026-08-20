import type { ChatRequest, ChatStreamEvent, ContextManifestInput } from '../../shared/types/domain';
import { desktopGateway } from '../../shared/platform/gateway';

export const chatController = {
  listSessions: (workspaceId: string) => desktopGateway.listChatSessions(workspaceId),
  createSession: (workspaceId: string, sessionId: string, title: string) =>
    desktopGateway.createChatSession(workspaceId, sessionId, title),
  planContext: (input: ContextManifestInput) => desktopGateway.planContext(input),
  confirmContext: (manifestId: string, sensitiveCloudConfirmed: boolean) =>
    desktopGateway.confirmContextManifest(manifestId, sensitiveCloudConfirmed),
  stream: (request: ChatRequest, onEvent: (event: ChatStreamEvent) => void) =>
    desktopGateway.streamChat(request, onEvent),
  stop: (requestId: string) => desktopGateway.stopChat(requestId),
};
