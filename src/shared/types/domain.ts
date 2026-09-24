export type Locale = 'zh-CN' | 'en-US';
export type {
  DocumentTarget,
  DocumentSnapshot,
  SelectionSnapshot,
  ParsedDocument,
} from './document';
export type CenterView = 'editor' | 'diff' | 'surface';
export type MessageRole = 'user' | 'assistant';
export type ProviderKind = 'silicon_flow' | 'deep_seek' | 'open_ai' | 'custom';
export type ResultType = 'document' | 'spreadsheet' | 'checklist' | 'form' | 'tool';
export type ResultStatus =
  'draft' | 'generating' | 'review_pending' | 'ready' | 'exporting' | 'failed' | 'archived';
export type ResultStorageKind = 'workspace_file' | 'standalone_file' | 'managed_local';
export type TextResultFormat = 'markdown' | 'plain_text' | 'csv' | 'json';
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
  pinned?: boolean;
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
  type?: ResultType;
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
  recoveryDraft: ResultRecoveryDraft | null;
}

export interface ResultRecoveryDraft {
  content: string;
  contentHash: string;
  baseHash: string;
  conflicted: boolean;
  updatedAt: string;
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

export type ExportFormat =
  'markdown' | 'plain_text' | 'docx' | 'pdf' | 'rtf' | 'csv' | 'xlsx' | 'json';
export type ExportStage =
  'preparing' | 'generating' | 'writing' | 'completed' | 'cancelled' | 'failed';

export interface ExportResultInput {
  exportId: string;
  resultId: string;
  revisionId: string;
  format: ExportFormat;
}

export interface ExportProgressEvent {
  exportId: string;
  stage: ExportStage;
  progress: number;
}

export interface ExportResultOutput extends ExportResultInput {
  status: 'completed' | 'cancelled';
  fileName: string | null;
}

export interface RecoveryResultDraftSummary {
  resultId: string;
  title: string;
  updatedAt: string;
}

export interface RecoveryExportJob {
  id: string;
  resultId: string;
  revisionId: string;
  format: ExportFormat;
  status:
    | 'preparing'
    | 'generating'
    | 'writing'
    | 'committed'
    | 'completed'
    | 'cancelled'
    | 'failed'
    | 'interrupted';
  fileName: string | null;
  errorCode: string | null;
  recovered: boolean;
  updatedAt: string;
}

export interface RecoveryStatus {
  schemaVersion: number;
  resultDrafts: RecoveryResultDraftSummary[];
  activeReviewCount: number;
  recoveredTaskCount: number;
  exportJobs: RecoveryExportJob[];
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

export interface ContextPackItem {
  personalKnowledge?: boolean;
  sourceId: string;
  label: string;
}

export interface ContextPack {
  id: string;
  workspaceId: string;
  name: string;
  items: ContextPackItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateContextPackInput {
  workspaceId: string;
  name: string;
  sourceIds: string[];
}

export interface DeleteContextPackOutput {
  deleted: boolean;
  originalFilesDeleted: false;
}

export type SearchItemKind = 'result' | 'document_source' | 'context_pack' | 'personal_knowledge';

export interface SearchAuthorizedContentInput {
  workspaceId: string | null;
  query: string;
  limit?: number;
}

export interface SearchAuthorizedContentItem {
  id: string;
  kind: SearchItemKind;
  title: string;
  snippet: string;
  updatedAt: string | null;
  score: number;
}

export interface SearchAuthorizedContentOutput {
  query: string;
  items: SearchAuthorizedContentItem[];
  indexedDocuments: number;
  skippedDocuments: number;
  indexMode: 'memory_lexical';
}

export interface RebuildAuthorizedSearchIndexOutput {
  clearedDocuments: number;
  resultDataChanged: false;
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
  pinned?: boolean;
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

export type ProcessingLocationView = 'local' | 'cloud';
export type ProcessingAvailability = 'ready' | 'setup_required' | 'unavailable';
export type LocalProviderKind = 'ollama' | 'lm_studio' | 'custom';
export type LocalProbeStatus = 'available' | 'unavailable';

export interface ProcessingOptions {
  activeProviderId: string;
  processingLocation: ProcessingLocationView;
  availability: ProcessingAvailability;
  localProviderAvailable: boolean;
  availableLocalProviders: number;
  probeCompleted: boolean;
}

export interface LocalProviderProbe {
  id: string;
  kind: LocalProviderKind;
  status: LocalProbeStatus;
  endpoint: string;
  models: string[];
  latencyMs: number | null;
  failureCode: string | null;
}

export type ContextSourceKind =
  'selection' | 'current_file' | 'project_file' | 'attached_document' | 'personal_knowledge';

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
  reviewSource?: ReviewSource;
  explanationOnly?: boolean;
}

export type ProcessingLocation = 'local' | 'cloud';
export type ContextManifestStatus = 'awaiting_confirmation' | 'confirmed';
export type ContextStrategy = 'full' | 'retrieval' | 'hybrid';
export type ContextSourceMode = 'full' | 'retrieved' | 'excluded';

export type WritingProfileScope = 'global' | 'workspace';

export interface TerminologyRule {
  term: string;
  preferred: string;
}

export interface WritingProfile {
  id: string;
  scope: WritingProfileScope;
  workspaceId: string | null;
  enabled: boolean;
  version: number;
  rules: string;
  terminology: TerminologyRule[];
  forbiddenWords: string[];
  exampleKnowledgeIds: string[];
  updatedAt: string;
}

export interface WritingProfileLayerSnapshot {
  id: string;
  scope: WritingProfileScope;
  version: number;
  rules: string;
}

export interface WritingProfileSnapshot {
  hash: string;
  composerVersion: string;
  enabled: boolean;
  layers: WritingProfileLayerSnapshot[];
  terminology: TerminologyRule[];
  forbiddenWords: string[];
  exampleKnowledgeIds: string[];
  instructionText: string;
  estimatedTokens: number;
}

export interface WritingProfileBundle {
  global: WritingProfile;
  workspace: WritingProfile | null;
  effective: WritingProfileSnapshot;
}

export interface SaveWritingProfileInput {
  scope: WritingProfileScope;
  workspaceId: string | null;
  enabled: boolean;
  rules: string;
  terminology: TerminologyRule[];
  forbiddenWords: string[];
  exampleKnowledgeIds: string[];
}

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
  contextPackIds: string[];
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
  writingProfile: WritingProfileSnapshot;
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
  contextPackIds?: string[];
  personalKnowledgeIds?: string[];
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
  | 'Form'
  | 'Checklist'
  | 'Owner'
  | 'Date'
  | 'Status'
  | 'Table'
  | 'IssueCard'
  | 'ResultSummary';

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
  errorCode?: string | null;
  negotiation?: A2uiNegotiationEvidence | null;
}

export interface A2uiNegotiationEvidence {
  receivedVersion: string | null;
  selectedVersion: string | null;
  catalogId: string | null;
  compatible: boolean;
}

export interface A2uiCapabilities {
  protocol: 'A2UI';
  preferredVersion: string;
  supportedVersions: string[];
  rendererCapabilities: {
    'v0.9': {
      supportedCatalogIds: string[];
    };
  };
  catalog: {
    catalogId: string;
    acceptsInlineCatalogs: boolean;
    components: A2uiComponentName[];
    actions: Array<'set_state' | 'submit_form' | 'request_patch'>;
    incrementalMessages: Array<'updateComponents' | 'updateDataModel'>;
  };
  legacyProfile: {
    version: '1.0';
    messageTypes: Array<'a2ui_surface' | 'a2ui_update'>;
    compatibilityOnly: boolean;
  };
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
  protocolVersion: string;
  catalogId: string | null;
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
  review: ReviewRequest | null;
  surface: A2uiSurface;
}

export interface A2uiTemplatePermission {
  actionType: string;
  risk: 'low' | 'medium' | 'high';
  decision: 'allowed' | 'review_required' | 'denied';
  description: string;
}

export interface A2uiTemplate {
  id: string;
  workspaceId: string;
  name: string;
  protocolVersion: string;
  catalogId: string;
  permissions: A2uiTemplatePermission[];
  valid: boolean;
  invalidReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenA2uiTemplateResult {
  template: A2uiTemplate;
  surface: A2uiSurface;
}

export interface TelemetrySettings {
  enabled: boolean;
  invitationEligible: boolean;
  invitationDismissed: boolean;
  uploadConfigured: false;
  collectionMode: 'local_only';
  localEventCount: number;
  eventCounts: Record<string, number>;
  kpis: TelemetryKpi[];
}

export interface TelemetryKpi {
  key:
    | 'task_completion_rate'
    | 'review_adoption_rate'
    | 'accepted_patch_rate'
    | 'undo_rate'
    | 'export_save_rate'
    | 'context_confirmation_rate';
  numerator: number;
  denominator: number;
  rateBasisPoints: number | null;
}

export interface SetTelemetrySettingsInput {
  enabled: boolean;
  dismissInvitation?: boolean;
}

export interface TelemetryEventDefinition {
  name: string;
  descriptionZh: string;
  descriptionEn: string;
  fields: string[];
}

export interface TelemetryDictionary {
  schemaVersion: 1;
  uploadConfigured: false;
  collectionMode: 'local_only';
  commonFields: string[];
  neverCollected: string[];
  events: TelemetryEventDefinition[];
  localEventCounts: Record<string, number>;
}
