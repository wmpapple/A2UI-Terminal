import type { ChatRequest, ChatStreamEvent } from '../../shared/types/domain';
import { desktopGateway } from '../../shared/platform/gateway';

export const chatController = {
  listSessions: (workspaceId: string) => desktopGateway.listChatSessions(workspaceId),
  createSession: (workspaceId: string, sessionId: string, title: string) =>
    desktopGateway.createChatSession(workspaceId, sessionId, title),
  stream: (request: ChatRequest, onEvent: (event: ChatStreamEvent) => void) =>
    desktopGateway.streamChat(request, onEvent),
  stop: (requestId: string) => desktopGateway.stopChat(requestId),
};
