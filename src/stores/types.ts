import type { StateCreator } from 'zustand';
import type {
  A2uiInspection,
  A2uiSurface,
  CenterView,
  ChatMessage,
  ChatSession,
  ContextSelection,
  DocumentVersion,
  DocumentVersionSummary,
  FileSaveStatus,
  PatchApplication,
  PatchReview,
  ProviderConfig,
  RecoveryDraftSummary,
  WorkspaceDraft,
  WorkspaceFile,
  WorkspaceFileEntry,
  WorkspaceSummary,
} from '../shared/types/domain';
import type { RuntimeMode } from '../shared/platform/runtime';

export interface AppState {
  runtimeMode: RuntimeMode;
  workspace: WorkspaceSummary | null;
  recentWorkspaces: WorkspaceSummary[];
  workspaceEntries: WorkspaceFileEntry[];
  workspaceLoading: boolean;
  workspaceError: string | null;
  files: WorkspaceFile[];
  openPaths: string[];
  activePath: string;
  dirtyPaths: string[];
  saveStatusByPath: Record<string, FileSaveStatus>;
  recoveryDrafts: Record<string, WorkspaceDraft>;
  recoveryDraftSummaries: RecoveryDraftSummary[];
  documentVersions: DocumentVersionSummary[];
  versionPreview: DocumentVersion | null;
  versionHistoryPath: string;
  versionHistoryLoading: boolean;
  versionHistoryError: string | null;
  centerView: CenterView;
  sessions: ChatSession[];
  activeSessionId: string;
  pendingDiff: PatchReview | null;
  lastPatchApplication: PatchApplication | null;
  patchBeforeByPath: Record<string, string>;
  patchApplying: boolean;
  patchError: string | null;
  selectedText: string;
  contextBySession: Record<string, ContextSelection>;
  providerConfigs: ProviderConfig[];
  activeProviderId: string;
  providerLoading: boolean;
  providerError: string | null;
  chatRequestId: string | null;
  chatError: string | null;
  a2uiSurfaces: A2uiSurface[];
  a2uiInspections: A2uiInspection[];
  activeSurfaceId: string;
  activeInspectionId: string;
  a2uiActionLoading: boolean;
  a2uiNotice: string | null;
  initializeWorkspace: () => Promise<void>;
  initializeProviders: () => Promise<void>;
  selectWorkspace: () => Promise<void>;
  selectContextFiles: () => Promise<void>;
  restoreWorkspace: (workspaceId: string) => Promise<void>;
  removeCurrentWorkspace: () => Promise<void>;
  openFile: (path: string) => void | Promise<void>;
  closeFile: (path: string) => void;
  updateFile: (path: string, content: string) => void;
  persistDraft: (path: string) => Promise<void>;
  saveFileToDisk: (path: string) => Promise<void>;
  restoreRecoveryDraft: (path: string) => void;
  discardRecoveryDraft: (path: string) => Promise<void>;
  loadDocumentVersions: (path: string) => Promise<void>;
  previewDocumentVersion: (path: string, versionId: string) => Promise<void>;
  restoreDocumentVersion: (path: string, versionId: string) => Promise<void>;
  clearVersionPreview: () => void;
  markSaved: (path: string) => void;
  clearWorkspaceError: () => void;
  setCenterView: (view: CenterView) => void;
  createSession: () => Promise<void>;
  selectSession: (id: string) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateMessage: (
    sessionId: string,
    messageId: string,
    content: string,
    status?: ChatMessage['status']
  ) => void;
  createProposal: () => void;
  rejectDiff: () => void;
  togglePatchChange: (changeId: string) => void;
  applyDiff: () => Promise<void>;
  undoLastPatch: () => Promise<void>;
  setSelectedText: (text: string) => void;
  setSessionContext: (sessionId: string, context: ContextSelection) => void;
  addFileToContext: (sessionId: string, path: string) => void;
  addFile: (file: WorkspaceFile) => void;
  saveProvider: (config: ProviderConfig, secret?: string) => Promise<void>;
  selectProvider: (providerId: string) => Promise<void>;
  deleteProviderKey: (providerId: string) => Promise<void>;
  testProvider: (providerId: string) => Promise<number>;
  sendChat: (
    prompt: string,
    context: ContextSelection,
    sensitiveConfirmed: boolean
  ) => Promise<void>;
  stopChat: () => Promise<void>;
  setActiveSurface: (surfaceId: string) => void;
  setActiveInspection: (inspectionId: string) => void;
  executeA2uiAction: (componentId: string, eventName: string, payload: unknown) => Promise<void>;
}

type AppStateCreator = StateCreator<AppState, [], [], AppState>;
export type AppSet = Parameters<AppStateCreator>[0];
export type AppGet = Parameters<AppStateCreator>[1];
