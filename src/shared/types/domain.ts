export type Locale = 'zh-CN' | 'en-US';
export type CenterView = 'editor' | 'diff' | 'surface';
export type MessageRole = 'user' | 'assistant';
export type ProviderKind = 'silicon_flow' | 'deep_seek' | 'open_ai' | 'custom';

export interface WorkspaceFile {
  path: string;
  name: string;
  language: string;
  content: string;
  contentHash?: string;
  sizeBytes?: number;
  editable?: boolean;
  extracted?: boolean;
  sourceId?: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  available: boolean;
  kind: 'directory' | 'standalone';
}

export interface SelectedWorkspaceFiles {
  workspace: WorkspaceSummary;
  documents: WorkspaceDocument[];
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  language: string;
  sizeBytes: number;
  readable: boolean;
  editable: boolean;
  extracted: boolean;
  sourceId?: string;
}

export interface WorkspaceDraft {
  content: string;
  baseHash: string;
  updatedAt: string;
}

export interface WorkspaceDocument extends WorkspaceFile {
  contentHash: string;
  sizeBytes: number;
  draft: WorkspaceDraft | null;
  editable: boolean;
  extracted: boolean;
}

export type FileSaveStatus = 'saved' | 'dirty' | 'draft' | 'saving' | 'conflict' | 'error';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  status?: 'streaming' | 'complete' | 'stopped' | 'error';
  requestId?: string | null;
  providerId?: string | null;
  errorCode?: string | null;
  protocolError?: string | null;
  createdAt?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  workspaceId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  endpoint: string;
  model: string;
  temperature: number;
  proxyUrl: string | null;
  configured: boolean;
  active: boolean;
}

export type ContextSourceKind = 'selection' | 'current_file' | 'project_file' | 'attached_document';

export interface ContextSource {
  kind: ContextSourceKind;
  label: string;
  content: string;
  baseHash?: string;
}

export interface ChatRequest {
  requestId: string;
  userMessageId: string;
  assistantMessageId: string;
  workspaceId: string;
  sessionId: string;
  providerId: string;
  prompt: string;
  recentMessageCount: number;
  contextSources: ContextSource[];
  sensitiveConfirmed: boolean;
}

export type ChatStreamEvent =
  | { type: 'delta'; requestId: string; messageId: string; delta: string }
  | { type: 'complete'; requestId: string; messageId: string }
  | { type: 'stopped'; requestId: string; messageId: string }
  | {
      type: 'error';
      requestId: string;
      messageId: string;
      code: string;
      message: string;
    };

export interface ChatStreamResult {
  requestId: string;
  messageId: string;
  content: string;
  status: 'complete' | 'stopped' | 'error';
  errorCode: string | null;
  patch?: PatchReview | null;
  patchError?: string | null;
  a2ui?: A2uiProcessResult | null;
}

export interface ContextSelection {
  selection: boolean;
  currentFile: boolean;
  recentMessages: boolean;
  recentMessageCount: number;
  projectFiles: string[];
}

export type PatchOperation = 'replace' | 'insert_before' | 'insert_after' | 'delete';
export type PatchRisk = 'low' | 'medium' | 'high';

export interface PatchAnchor {
  before: string;
  beforeHash?: string | null;
}

export interface PatchChange {
  id: string;
  path: string;
  operation: PatchOperation;
  baseHash?: string | null;
  anchor: PatchAnchor;
  content: string;
  reason: string;
  risk: PatchRisk;
}

export interface DocumentPatch {
  version: '1.0';
  type: 'document_patch';
  workspaceId: string;
  baseRevision?: string | null;
  summary: string;
  changes: PatchChange[];
}

export interface PatchReviewChange {
  id: string;
  path: string;
  operation: PatchOperation;
  reason: string;
  risk: PatchRisk;
  before: string;
  after: string;
  selected: boolean;
}

export interface PatchReview {
  id: string;
  workspaceId: string;
  summary: string;
  patch: DocumentPatch;
  changes: PatchReviewChange[];
}

export interface AppliedPatchFile {
  path: string;
  content: string;
  contentHash: string;
}

export interface PatchApplication {
  operationId: string;
  summary: string;
  undoOf: string | null;
  files: AppliedPatchFile[];
}

export type A2uiComponentName =
  | 'Row'
  | 'Column'
  | 'Stack'
  | 'Text'
  | 'Card'
  | 'Badge'
  | 'Progress'
  | 'TextField'
  | 'Select'
  | 'Checkbox'
  | 'Button'
  | 'Tabs'
  | 'Form';

export interface A2uiAction {
  type: 'set_state' | 'submit_form' | 'request_patch';
  target?: string | null;
  value?: unknown;
}

export interface A2uiNode {
  id: string;
  component: A2uiComponentName;
  props: Record<string, unknown>;
  children: A2uiNode[];
  actions: Record<string, A2uiAction>;
}

export interface A2uiValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  durationMs: number;
}

export interface A2uiEvent {
  id: string;
  componentId: string;
  eventName: string;
  actionType: string;
  risk: 'low' | 'medium' | 'high';
  decision: 'allowed' | 'review_required' | 'denied';
  payload: unknown;
  durationMs: number;
  createdAt: string;
}

export interface A2uiSurface {
  surfaceId: string;
  workspaceId: string;
  sessionId: string;
  messageId: string;
  revision: number;
  root: A2uiNode;
  data: Record<string, unknown>;
  rawMessage: string;
  validation: A2uiValidation;
  events: A2uiEvent[];
}

export interface A2uiInspection {
  id: string;
  messageId: string;
  surfaceId: string | null;
  rawMessage: string;
  validation: A2uiValidation;
  createdAt: string | null;
}

export interface A2uiProcessResult {
  surface: A2uiSurface | null;
  inspection: A2uiInspection;
}

export interface A2uiActionResult {
  risk: 'low' | 'medium' | 'high';
  decision: 'allowed' | 'review_required' | 'denied';
  message: string;
  surface: A2uiSurface;
}
