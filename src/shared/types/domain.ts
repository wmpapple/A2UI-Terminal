export type Locale = 'zh-CN' | 'en-US';
export type CenterView = 'editor' | 'diff' | 'surface';
export type MessageRole = 'user' | 'assistant';
export type ProviderKind = 'silicon_flow' | 'deep_seek' | 'open_ai' | 'custom';
export type ResultType = 'document' | 'spreadsheet' | 'checklist' | 'form' | 'tool';
export type ResultStatus =
  'draft' | 'generating' | 'review_pending' | 'ready' | 'exporting' | 'failed' | 'archived';
export type ResultStorageKind = 'workspace_file' | 'standalone_file' | 'managed_local';
export type TextResultFormat = 'markdown' | 'plain_text';
export type TaskKind = 'write' | 'modify' | 'organize' | 'analyze';
export type TaskStatus =
  | 'draft'
  | 'awaiting_input'
  | 'ready'
  | 'running'
  | 'review_pending'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type TemplateFieldKind = 'short_text' | 'select';

export interface TemplateField {
  id: string;
  label: string;
  kind: TemplateFieldKind;
  required: boolean;
  options: string[];
  defaultValue: unknown | null;
  maxLength: number | null;
}

export interface TaskTemplate {
  id: string;
  version: number;
  name: string;
  description: string;
  kind: TaskKind;
  desiredResultType: 'document';
  fields: TemplateField[];
  defaultSections: string[];
  riskLevel: 'low' | 'medium' | 'high';
  builtin: boolean;
}

export interface TaskQuestion {
  fieldId: string;
  prompt: string;
  kind: TemplateFieldKind;
  options: string[];
  required: boolean;
  maxLength: number | null;
}

export interface TaskDetail {
  id: string;
  workspaceId: string;
  templateId: string;
  templateVersion: number;
  kind: TaskKind;
  desiredResultType: 'document';
  status: TaskStatus;
  inputAnswers: Record<string, unknown>;
  questions: TaskQuestion[];
  resultId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskRunResult {
  task: TaskDetail;
  result: ResultDetail;
  outputMode: 'local_scaffold';
}

export interface ResultSummary {
  id: string;
  workspaceId: string;
  type: ResultType;
  title: string;
  status: ResultStatus;
  storageKind: ResultStorageKind;
  currentRevisionId: string | null;
  a2uiSurfaceId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ResultDetail extends ResultSummary {
  storageRef: string;
  activeSessionId: string | null;
  managedState: Record<string, unknown> | null;
}

export interface CreateTextResultInput {
  title: string;
  fileName: string;
  format: TextResultFormat;
}

export interface ResultDocument {
  result: ResultDetail;
  format: TextResultFormat;
  content: string;
  contentHash: string;
  sizeBytes: number;
  editable: boolean;
  appliedReview: ResultAppliedReview | null;
}

export interface ResultAppliedReview {
  reviewId: string;
  workspaceId: string;
}

export interface ResultRevisionSummary {
  id: string;
  contentHash: string;
  source: 'legacy' | 'initial' | 'autosave' | 'patch' | 'restore';
  summary: string | null;
  createdAt: string;
  isCurrent: boolean;
}

export interface ResultRevision extends ResultRevisionSummary {
  content: string;
}

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

export type ImportBatchStatus = 'awaiting_confirmation' | 'blocked' | 'confirmed' | 'cancelled';
export type ImportCapability =
  'editable_text' | 'read_only_text' | 'structured_data' | 'visual_context' | 'unsupported';
export type ImportItemStatus = 'ready' | 'planned' | 'rejected';

export interface ImportItem {
  id: string;
  name: string;
  extension: string;
  sizeBytes: number;
  capability: ImportCapability;
  status: ImportItemStatus;
  readable: boolean;
  editable: boolean;
  reasonCode: string | null;
  reason: string | null;
  alternative: string | null;
  warnings: string[];
}

export interface ImportBatch {
  id: string;
  status: ImportBatchStatus;
  items: ImportItem[];
  totalSizeBytes: number;
  maxFiles: number;
  maxBatchBytes: number;
  canConfirm: boolean;
  failureCode: string | null;
  failureReason: string | null;
}

export interface ImportConfirmation {
  batch: ImportBatch;
  workspace: WorkspaceSummary | null;
  documents: WorkspaceDocument[];
  sources: DocumentSource[];
}

export type DocumentSourceKind = 'text' | 'table' | 'image';
export type DocumentSourceCapability =
  'editable_text' | 'read_only_text' | 'structured_data' | 'visual_context';

export interface TableLimits {
  maxSheets: number;
  maxRowsPerSheet: number;
  maxColumnsPerSheet: number;
  maxCellsTotal: number;
  maxCellChars: number;
}

export interface TableSourceSummary {
  sheetNames: string[];
  rowCount: number;
  columnCount: number;
  cellCount: number;
  formulaCellCount: number;
  formulaInjectionRiskCellCount: number;
  limits: TableLimits;
}

export interface ImageSourceSummary {
  width: number;
  height: number;
  animated: boolean;
  originalPreserved: boolean;
  localPreviewAvailable: boolean;
  visualModelRequired: boolean;
}

export interface DocumentSource {
  id: string;
  workspaceId: string;
  name: string;
  extension: string;
  kind: DocumentSourceKind;
  capability: DocumentSourceCapability;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  editable: boolean;
  warnings: string[];
  table: TableSourceSummary | null;
  image: ImageSourceSummary | null;
}

export interface TableCell {
  value: string;
  formula: boolean;
  formulaInjectionRisk: boolean;
}

export interface TableSheet {
  name: string;
  rows: TableCell[][];
}

export interface TableSourceContent {
  sheets: TableSheet[];
  limits: TableLimits;
}

export interface DocumentSourceContent {
  source: DocumentSource;
  textContent: string | null;
  tableContent: TableSourceContent | null;
  imageDataUrl: string | null;
  visualModelAvailable: boolean;
  notice: string;
}

export interface RevokeDocumentSourceResult {
  revoked: boolean;
  originalFileDeleted: false;
}

export interface ImportDropBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SetImportDropTargetInput {
  targetId: string;
  enabled: boolean;
  workspaceId: string | null;
  bounds: ImportDropBounds | null;
}

export interface ImportDropOutcome {
  targetId: string;
  batch: ImportBatch | null;
  errorCode: string | null;
  errorMessage: string | null;
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

export interface RecoveryDraftSummary {
  relativePath: string;
  baseHash: string;
  updatedAt: string;
  currentHash: string | null;
  conflict: boolean;
  available: boolean;
}

export interface WorkspaceDocument extends WorkspaceFile {
  contentHash: string;
  sizeBytes: number;
  draft: WorkspaceDraft | null;
  editable: boolean;
  extracted: boolean;
}

export interface DocumentVersionSummary {
  id: string;
  relativePath: string;
  contentHash: string;
  source: 'legacy' | 'initial' | 'autosave' | 'patch' | 'restore';
  summary: string | null;
  versionKind: 'snapshot' | 'before' | 'after';
  createdAt: string;
  isCurrent: boolean;
}

export interface DocumentVersion extends DocumentVersionSummary {
  content: string;
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
  contextManifestId: string;
}

export type ProcessingLocation = 'local' | 'cloud';
export type ContextManifestStatus = 'awaiting_confirmation' | 'confirmed';
export type ContextStrategy = 'full' | 'retrieval' | 'hybrid';
export type ContextSourceMode = 'full' | 'retrieved' | 'excluded';

export interface ContextCandidate {
  kind: ContextSourceKind;
  label: string;
  selected: boolean;
  sourceId?: string;
  content?: string;
  baseHash?: string;
}

export interface ContextManifestInput {
  workspaceId: string;
  sessionId: string;
  providerId: string;
  prompt: string;
  candidates: ContextCandidate[];
  includeRecentMessages: boolean;
  recentMessageCount: number;
}

export interface ContextManifestSource {
  kind: string;
  label: string;
  sourceRef: string | null;
  contentHash: string | null;
  sizeBytes: number;
  characterCount: number;
  mode: ContextSourceMode;
  selectedRanges: Array<{
    chunkId: string;
    startCharacter: number;
    endCharacter: number;
  }>;
  exclusionReason: string | null;
}

export interface ContextManifest {
  id: string;
  workspaceId: string;
  sessionId: string;
  providerId: string;
  processingLocation: ProcessingLocation;
  strategy: ContextStrategy;
  indexMode: 'none' | 'memory_lexical';
  status: ContextManifestStatus;
  includedSources: ContextManifestSource[];
  excludedSources: ContextManifestSource[];
  characterCount: number;
  estimatedTokens: number;
  tokenBudget: number;
  retrievedChunkCount: number;
  sensitiveWarning: boolean;
  requiresSensitiveConfirmation: boolean;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
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
      retryable: boolean;
      retryAfterSeconds: number | null;
    };

export interface ChatStreamResult {
  requestId: string;
  messageId: string;
  content: string;
  status: 'complete' | 'stopped' | 'error';
  errorCode: string | null;
  errorMessage?: string | null;
  retryable?: boolean;
  retryAfterSeconds?: number | null;
  patch?: PatchReview | null;
  review?: ReviewRequest | null;
  patchError?: string | null;
  a2ui?: A2uiProcessResult | null;
}

export interface ContextSelection {
  selection: boolean;
  currentFile: boolean;
  recentMessages: boolean;
  recentMessageCount: number;
  projectFiles: string[];
  documentSourceIds?: string[];
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

export type ReviewSource = 'chat' | 'selection' | 'template' | 'a2ui_action' | 'import_transform';
export type ReviewOperationKind = 'document_patch' | 'create_file' | 'replace_result';
export type ReviewStatus =
  | 'pending'
  | 'partially_accepted'
  | 'accepted'
  | 'rejected'
  | 'applied'
  | 'conflicted'
  | 'failed'
  | 'undone';
export type ReviewConflictResolution = 'regenerate' | 'save_copy' | 'keep_current';
export type ReviewBlockStatus = 'pending' | 'accepted' | 'rejected';

export interface ReviewBlock {
  id: string;
  kind: ReviewOperationKind;
  status: ReviewBlockStatus;
  targetLabel: string;
  operation: string | null;
  before: string;
  after: string;
  reason: string;
  risk: PatchRisk;
  suggestedFileName: string | null;
  decidedFileName: string | null;
  selected?: boolean;
}

export interface ReviewRequest {
  id: string;
  workspaceId: string;
  resultId: string | null;
  source: ReviewSource;
  operationKind: ReviewOperationKind;
  status: ReviewStatus;
  summary: string;
  risk: PatchRisk;
  baseRevisionId: string | null;
  baseHash: string | null;
  blocks: ReviewBlock[];
  applicationOperationId: string | null;
  outputResultId: string | null;
  errorCode: string | null;
  createdAt: string;
  decidedAt: string | null;
  appliedAt: string | null;
}

export interface ReviewBlockDecision {
  blockId: string;
  accepted: boolean;
  fileName?: string | null;
}

export interface ReviewApplication {
  reviewId: string;
  status: ReviewStatus;
  operationId: string | null;
  files: AppliedPatchFile[];
  result: ResultDocument | null;
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
