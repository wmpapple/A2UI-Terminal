import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getRuntimeMode } from './runtime';
import type {
  A2uiActionResult,
  A2uiInspection,
  A2uiProcessResult,
  A2uiSurface,
  ChatRequest,
  ChatSession,
  ChatStreamEvent,
  ChatStreamResult,
  ProviderConfig,
  RecoveryDraftSummary,
  DocumentPatch,
  DocumentVersion,
  DocumentVersionSummary,
  PatchApplication,
  PatchReview,
  SelectedWorkspaceFiles,
  WorkspaceDocument,
  WorkspaceFileEntry,
  WorkspaceSummary,
  ResultDetail,
  ResultDocument,
  ResultRevision,
  ResultRevisionSummary,
  ResultSummary,
  CreateTextResultInput,
  ImportBatch,
  ImportConfirmation,
  ImportDropOutcome,
  SetImportDropTargetInput,
  TaskDetail,
  TaskRunResult,
  TaskTemplate,
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

  async exportDiagnostics(): Promise<{ exported: boolean; fileName: string | null }> {
    requireDesktop();
    return invoke<{ exported: boolean; fileName: string | null }>('export_diagnostics');
  },

  async listResults(workspaceId?: string, includeArchived = false): Promise<ResultSummary[]> {
    requireDesktop();
    return invoke<ResultSummary[]>('list_results', {
      workspaceId: workspaceId ?? null,
      includeArchived,
    });
  },

  async getResult(resultId: string): Promise<ResultDetail> {
    requireDesktop();
    return invoke<ResultDetail>('get_result', { resultId });
  },

  async createTextResult(input: CreateTextResultInput): Promise<ResultDocument> {
    requireDesktop();
    return invoke<ResultDocument>('create_text_result', { input });
  },

  async readResultDocument(resultId: string): Promise<ResultDocument> {
    requireDesktop();
    return invoke<ResultDocument>('read_result_document', { resultId });
  },

  async saveResultDocument(
    resultId: string,
    content: string,
    baseHash: string
  ): Promise<ResultDocument> {
    requireDesktop();
    return invoke<ResultDocument>('save_result_document', {
      input: { resultId, content, baseHash },
    });
  },

  async listResultRevisions(resultId: string): Promise<ResultRevisionSummary[]> {
    requireDesktop();
    return invoke<ResultRevisionSummary[]>('list_result_revisions', { resultId });
  },

  async readResultRevision(resultId: string, revisionId: string): Promise<ResultRevision> {
    requireDesktop();
    return invoke<ResultRevision>('read_result_revision', { resultId, revisionId });
  },

  async restoreResultRevision(
    resultId: string,
    revisionId: string,
    baseHash: string
  ): Promise<ResultDocument> {
    requireDesktop();
    return invoke<ResultDocument>('restore_result_revision', {
      input: { resultId, revisionId, baseHash },
    });
  },

  async duplicateResult(resultId: string): Promise<ResultDocument> {
    requireDesktop();
    return invoke<ResultDocument>('duplicate_result', { resultId });
  },

  async listTaskTemplates(): Promise<TaskTemplate[]> {
    requireDesktop();
    return invoke<TaskTemplate[]>('list_task_templates');
  },

  async createTask(workspaceId: string, templateId: string): Promise<TaskDetail> {
    requireDesktop();
    return invoke<TaskDetail>('create_task', { input: { workspaceId, templateId } });
  },

  async answerTaskQuestions(taskId: string, answers: Record<string, unknown>): Promise<TaskDetail> {
    requireDesktop();
    return invoke<TaskDetail>('answer_task_questions', { input: { taskId, answers } });
  },

  async getTask(taskId: string): Promise<TaskDetail> {
    requireDesktop();
    return invoke<TaskDetail>('get_task', { taskId });
  },

  async startTask(taskId: string): Promise<TaskRunResult> {
    requireDesktop();
    return invoke<TaskRunResult>('start_task', { taskId });
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

  async listRecoveryDrafts(workspaceId: string): Promise<RecoveryDraftSummary[]> {
    requireDesktop();
    return invoke<RecoveryDraftSummary[]>('list_recovery_drafts', { workspaceId });
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

  async selectImportSources(workspaceId?: string): Promise<ImportBatch | null> {
    requireDesktop();
    return invoke<ImportBatch | null>('select_import_sources', {
      workspaceId: workspaceId ?? null,
    });
  },

  async inspectImportBatch(batchId: string): Promise<ImportBatch> {
    requireDesktop();
    return invoke<ImportBatch>('inspect_import_batch', { batchId });
  },

  async setImportDropTarget(input: SetImportDropTargetInput): Promise<void> {
    requireDesktop();
    return invoke<void>('set_import_drop_target', { input });
  },

  async listenImportDropOutcomes(
    handler: (outcome: ImportDropOutcome) => void
  ): Promise<() => void> {
    requireDesktop();
    return listen<ImportDropOutcome>('import-drop-outcome', (event) => handler(event.payload));
  },

  async confirmImport(
    batchId: string,
    acceptedItemIds: string[],
    confirmed: boolean
  ): Promise<ImportConfirmation> {
    requireDesktop();
    return invoke<ImportConfirmation>('confirm_import', {
      input: { batchId, acceptedItemIds, confirmed },
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

  async listDocumentVersions(
    workspaceId: string,
    relativePath: string
  ): Promise<DocumentVersionSummary[]> {
    requireDesktop();
    return invoke<DocumentVersionSummary[]>('list_document_versions', {
      workspaceId,
      relativePath,
    });
  },

  async readDocumentVersion(
    workspaceId: string,
    relativePath: string,
    versionId: string
  ): Promise<DocumentVersion> {
    requireDesktop();
    return invoke<DocumentVersion>('read_document_version', {
      workspaceId,
      relativePath,
      versionId,
    });
  },

  async restoreDocumentVersion(
    workspaceId: string,
    relativePath: string,
    versionId: string,
    baseHash: string
  ): Promise<SaveWorkspaceFileResult> {
    requireDesktop();
    return invoke<SaveWorkspaceFileResult>('restore_document_version', {
      workspaceId,
      relativePath,
      versionId,
      baseHash,
    });
  },

  async listProviderConfigs(): Promise<ProviderConfig[]> {
    requireDesktop();
    return invoke<ProviderConfig[]>('list_provider_configs');
  },

  async saveProviderConfig(config: ProviderConfig, secret?: string): Promise<ProviderConfig> {
    requireDesktop();
    const input = {
      id: config.id,
      kind: config.kind,
      endpoint: config.endpoint,
      model: config.model,
      temperature: config.temperature,
      proxyUrl: config.proxyUrl,
    };
    return invoke<ProviderConfig>('save_provider_config', {
      config: input,
      secret: secret?.trim() || null,
    });
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

  async validateDocumentPatch(workspaceId: string, raw: string): Promise<PatchReview> {
    requireDesktop();
    return invoke<PatchReview>('validate_document_patch', { workspaceId, raw });
  },

  async applyDocumentPatch(request: {
    workspaceId: string;
    patch: DocumentPatch;
    selectedChangeIds: string[];
    sessionId?: string;
    assistantMessageId?: string;
  }): Promise<PatchApplication> {
    requireDesktop();
    return invoke<PatchApplication>('apply_document_patch', { request });
  },

  async undoDocumentPatch(workspaceId: string, operationId: string): Promise<PatchApplication> {
    requireDesktop();
    return invoke<PatchApplication>('undo_document_patch', { workspaceId, operationId });
  },

  async processA2uiMessage(request: {
    workspaceId: string;
    sessionId: string;
    messageId: string;
    rawMessage: string;
  }): Promise<A2uiProcessResult | null> {
    requireDesktop();
    return invoke<A2uiProcessResult | null>('process_a2ui_message', { request });
  },

  async listA2uiSurfaces(workspaceId: string): Promise<A2uiSurface[]> {
    requireDesktop();
    return invoke<A2uiSurface[]>('list_a2ui_surfaces', { workspaceId });
  },

  async listA2uiInspections(workspaceId: string): Promise<A2uiInspection[]> {
    requireDesktop();
    return invoke<A2uiInspection[]>('list_a2ui_inspections', { workspaceId });
  },

  async deleteA2uiSurface(workspaceId: string, surfaceId: string): Promise<boolean> {
    requireDesktop();
    return invoke<boolean>('delete_a2ui_surface', { workspaceId, surfaceId });
  },

  async executeA2uiAction(request: {
    workspaceId: string;
    surfaceId: string;
    componentId: string;
    eventName: string;
    payload?: unknown;
  }): Promise<A2uiActionResult> {
    requireDesktop();
    return invoke<A2uiActionResult>('execute_a2ui_action', { request });
  },
};
