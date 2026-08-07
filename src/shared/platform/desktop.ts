import { Channel, invoke } from '@tauri-apps/api/core';
import { getRuntimeMode } from './runtime';
import type {
  ChatRequest,
  ChatSession,
  ChatStreamEvent,
  ChatStreamResult,
  ProviderConfig,
  SelectedWorkspaceFiles,
  WorkspaceDocument,
  WorkspaceFileEntry,
  WorkspaceSummary,
} from '../types/domain';

export interface BootstrapStatus {
  runtime: 'desktop';
  databaseReady: boolean;
  schemaVersion: number;
  credentialStore: 'windows-credential-manager';
}

export interface SecretStatus {
  providerId: string;
  configured: boolean;
}

export interface SaveWorkspaceFileResult {
  path: string;
  contentHash: string;
  sizeBytes: number;
}

const requireDesktop = (): void => {
  if (getRuntimeMode() !== 'desktop') {
    throw new Error('Desktop API is unavailable in Web Mock mode.');
  }
};

export const desktopApi = {
  async getBootstrapStatus(): Promise<BootstrapStatus> {
    requireDesktop();
    return invoke<BootstrapStatus>('get_bootstrap_status');
  },

  async setProviderSecret(providerId: string, secret: string): Promise<SecretStatus> {
    requireDesktop();
    return invoke<SecretStatus>('set_provider_secret', { providerId, secret });
  },

  async getProviderSecretStatus(providerId: string): Promise<SecretStatus> {
    requireDesktop();
    return invoke<SecretStatus>('provider_secret_status', { providerId });
  },

  async deleteProviderSecret(providerId: string): Promise<SecretStatus> {
    requireDesktop();
    return invoke<SecretStatus>('delete_provider_secret', { providerId });
  },

  async clearAllLocalData(confirmation: string): Promise<{ cleared: boolean }> {
    requireDesktop();
    return invoke<{ cleared: boolean }>('clear_all_local_data', { confirmation });
  },

  async selectWorkspace(): Promise<WorkspaceSummary | null> {
    requireDesktop();
    return invoke<WorkspaceSummary | null>('select_workspace');
  },

  async listRecentWorkspaces(): Promise<WorkspaceSummary[]> {
    requireDesktop();
    return invoke<WorkspaceSummary[]>('list_recent_workspaces');
  },

  async restoreWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
    requireDesktop();
    return invoke<WorkspaceSummary>('restore_workspace', { workspaceId });
  },

  async listWorkspaceFiles(workspaceId: string): Promise<WorkspaceFileEntry[]> {
    requireDesktop();
    return invoke<WorkspaceFileEntry[]>('list_workspace_files', { workspaceId });
  },

  async readWorkspaceFile(workspaceId: string, relativePath: string): Promise<WorkspaceDocument> {
    requireDesktop();
    return invoke<WorkspaceDocument>('read_workspace_file', { workspaceId, relativePath });
  },

  async saveWorkspaceFile(
    workspaceId: string,
    relativePath: string,
    content: string,
    baseHash: string
  ): Promise<SaveWorkspaceFileResult> {
    requireDesktop();
    return invoke<SaveWorkspaceFileResult>('save_workspace_file', {
      workspaceId,
      relativePath,
      content,
      baseHash,
    });
  },

  async saveWorkspaceDraft(
    workspaceId: string,
    relativePath: string,
    content: string,
    baseHash: string
  ): Promise<void> {
    requireDesktop();
    return invoke<void>('save_workspace_draft', {
      workspaceId,
      relativePath,
      content,
      baseHash,
    });
  },

  async discardWorkspaceDraft(workspaceId: string, relativePath: string): Promise<void> {
    requireDesktop();
    return invoke<void>('discard_workspace_draft', { workspaceId, relativePath });
  },

  async removeWorkspace(
    workspaceId: string
  ): Promise<{ removed: boolean; projectFilesDeleted: false }> {
    requireDesktop();
    return invoke<{ removed: boolean; projectFilesDeleted: false }>('remove_workspace', {
      workspaceId,
    });
  },

  async selectContextFiles(workspaceId?: string): Promise<SelectedWorkspaceFiles | null> {
    requireDesktop();
    return invoke<SelectedWorkspaceFiles | null>('select_context_files', {
      workspaceId: workspaceId ?? null,
    });
  },

  async saveContextFile(
    sourceId: string,
    content: string,
    baseHash: string
  ): Promise<SaveWorkspaceFileResult> {
    requireDesktop();
    return invoke<SaveWorkspaceFileResult>('save_context_file', {
      sourceId,
      content,
      baseHash,
    });
  },

  async listProviderConfigs(): Promise<ProviderConfig[]> {
    requireDesktop();
    return invoke<ProviderConfig[]>('list_provider_configs');
  },

  async saveProviderConfig(config: ProviderConfig): Promise<ProviderConfig> {
    requireDesktop();
    const input = {
      id: config.id,
      kind: config.kind,
      endpoint: config.endpoint,
      model: config.model,
      temperature: config.temperature,
      proxyUrl: config.proxyUrl,
    };
    return invoke<ProviderConfig>('save_provider_config', { config: input });
  },

  async setActiveProvider(providerId: string): Promise<void> {
    requireDesktop();
    return invoke<void>('set_active_provider', { providerId });
  },

  async testProviderConnection(
    providerId: string
  ): Promise<{ providerId: string; reachable: boolean; latencyMs: number }> {
    requireDesktop();
    return invoke('test_provider_connection', { providerId });
  },

  async listChatSessions(workspaceId: string): Promise<ChatSession[]> {
    requireDesktop();
    return invoke<ChatSession[]>('list_chat_sessions', { workspaceId });
  },

  async createChatSession(
    workspaceId: string,
    sessionId: string,
    title: string
  ): Promise<ChatSession> {
    requireDesktop();
    return invoke<ChatSession>('create_chat_session', { workspaceId, sessionId, title });
  },

  async streamChat(
    request: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void
  ): Promise<ChatStreamResult> {
    requireDesktop();
    const channel = new Channel<ChatStreamEvent>();
    channel.onmessage = onEvent;
    return invoke<ChatStreamResult>('stream_chat', { request, onEvent: channel });
  },

  async stopChat(requestId: string): Promise<boolean> {
    requireDesktop();
    return invoke<boolean>('stop_chat', { requestId });
  },
};
