import type {
  A2uiProcessResult,
  ChatSession,
  ChatStreamEvent,
  ChatStreamResult,
  ContextManifest,
  DocumentPatch,
  DocumentSource,
  DocumentSourceContent,
  DocumentVersion,
  DocumentVersionSummary,
  ImportBatch,
  ImportDropOutcome,
  PatchApplication,
  PatchReview,
  ResultDetail,
  ResultDocument,
  ResultRevision,
  ResultSummary,
  TaskDetail,
  TaskRunResult,
  TaskTemplate,
  WorkspaceDocument,
} from '../types/domain';

export interface AppErrorContract {
  code: string;
  message: string;
  retryable: boolean;
  httpStatus: number | null;
  retryAfterSeconds: number | null;
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);
const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isNumber(value);
const hasExactKeys = (value: JsonObject, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

const messageRoles = new Set(['user', 'assistant']);
const messageStatuses = new Set(['streaming', 'complete', 'stopped', 'error']);
const streamStatuses = new Set(['complete', 'stopped', 'error']);
const patchOperations = new Set(['replace', 'insert_before', 'insert_after', 'delete']);
const patchRisks = new Set(['low', 'medium', 'high']);
const versionSources = new Set(['legacy', 'initial', 'autosave', 'patch', 'restore']);
const versionKinds = new Set(['snapshot', 'before', 'after']);
const a2uiComponents = new Set([
  'Row',
  'Column',
  'Stack',
  'Text',
  'Card',
  'Badge',
  'Progress',
  'TextField',
  'Select',
  'Checkbox',
  'Button',
  'Tabs',
  'Form',
]);
const a2uiActions = new Set(['set_state', 'submit_form', 'request_patch']);
const resultTypes = new Set(['document', 'spreadsheet', 'checklist', 'form', 'tool']);
const resultStatuses = new Set([
  'draft',
  'generating',
  'review_pending',
  'ready',
  'exporting',
  'failed',
  'archived',
]);
const resultStorageKinds = new Set(['workspace_file', 'standalone_file', 'managed_local']);
const taskKinds = new Set(['write', 'modify', 'organize', 'analyze']);
const taskStatuses = new Set([
  'draft',
  'awaiting_input',
  'ready',
  'running',
  'review_pending',
  'completed',
  'failed',
  'cancelled',
]);
const templateFieldKinds = new Set(['short_text', 'select']);
const importBatchStatuses = new Set(['awaiting_confirmation', 'blocked', 'confirmed', 'cancelled']);
const importCapabilities = new Set([
  'editable_text',
  'read_only_text',
  'structured_data',
  'visual_context',
  'unsupported',
]);
const importItemStatuses = new Set(['ready', 'planned', 'rejected']);
const documentSourceKinds = new Set(['text', 'table', 'image']);
const documentSourceCapabilities = new Set([
  'editable_text',
  'read_only_text',
  'structured_data',
  'visual_context',
]);
const processingLocations = new Set(['local', 'cloud']);
const contextManifestStatuses = new Set(['awaiting_confirmation', 'confirmed']);
const contextStrategies = new Set(['full', 'retrieval', 'hybrid']);
const contextSourceModes = new Set(['full', 'retrieved', 'excluded']);

const isContextChunkRange = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.chunkId) &&
  isNumber(value.startCharacter) &&
  isNumber(value.endCharacter);

const isContextManifestSource = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.kind) &&
  isString(value.label) &&
  isNullableString(value.sourceRef) &&
  isNullableString(value.contentHash) &&
  isNumber(value.sizeBytes) &&
  isNumber(value.characterCount) &&
  isString(value.mode) &&
  contextSourceModes.has(value.mode) &&
  Array.isArray(value.selectedRanges) &&
  value.selectedRanges.every(isContextChunkRange) &&
  isNullableString(value.exclusionReason);

export const isContextManifest = (value: unknown): value is ContextManifest =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.workspaceId) &&
  isString(value.sessionId) &&
  isString(value.providerId) &&
  isString(value.processingLocation) &&
  processingLocations.has(value.processingLocation) &&
  isString(value.strategy) &&
  contextStrategies.has(value.strategy) &&
  isString(value.indexMode) &&
  ['none', 'memory_lexical'].includes(value.indexMode) &&
  isString(value.status) &&
  contextManifestStatuses.has(value.status) &&
  Array.isArray(value.includedSources) &&
  value.includedSources.every(isContextManifestSource) &&
  Array.isArray(value.excludedSources) &&
  value.excludedSources.every(isContextManifestSource) &&
  isNumber(value.characterCount) &&
  isNumber(value.estimatedTokens) &&
  isNumber(value.tokenBudget) &&
  isNumber(value.retrievedChunkCount) &&
  isBoolean(value.sensitiveWarning) &&
  isBoolean(value.requiresSensitiveConfirmation) &&
  isString(value.createdAt) &&
  isString(value.expiresAt) &&
  isNullableString(value.confirmedAt);

const isTableLimits = (value: unknown): boolean =>
  isObject(value) &&
  isNumber(value.maxSheets) &&
  isNumber(value.maxRowsPerSheet) &&
  isNumber(value.maxColumnsPerSheet) &&
  isNumber(value.maxCellsTotal) &&
  isNumber(value.maxCellChars);

export const isDocumentSource = (value: unknown): value is DocumentSource =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.workspaceId) &&
  isString(value.name) &&
  isString(value.extension) &&
  isString(value.kind) &&
  documentSourceKinds.has(value.kind) &&
  isString(value.capability) &&
  documentSourceCapabilities.has(value.capability) &&
  isString(value.mimeType) &&
  isNumber(value.sizeBytes) &&
  isString(value.contentHash) &&
  isBoolean(value.editable) &&
  isStringArray(value.warnings) &&
  (value.table === null ||
    (isObject(value.table) &&
      isStringArray(value.table.sheetNames) &&
      isNumber(value.table.rowCount) &&
      isNumber(value.table.columnCount) &&
      isNumber(value.table.cellCount) &&
      isNumber(value.table.formulaCellCount) &&
      isNumber(value.table.formulaInjectionRiskCellCount) &&
      isTableLimits(value.table.limits))) &&
  (value.image === null ||
    (isObject(value.image) &&
      isNumber(value.image.width) &&
      isNumber(value.image.height) &&
      isBoolean(value.image.animated) &&
      isBoolean(value.image.originalPreserved) &&
      isBoolean(value.image.localPreviewAvailable) &&
      isBoolean(value.image.visualModelRequired)));

const isTableCell = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.value) &&
  isBoolean(value.formula) &&
  isBoolean(value.formulaInjectionRisk);

export const isDocumentSourceContent = (value: unknown): value is DocumentSourceContent =>
  isObject(value) &&
  isDocumentSource(value.source) &&
  isNullableString(value.textContent) &&
  (value.tableContent === null ||
    (isObject(value.tableContent) &&
      Array.isArray(value.tableContent.sheets) &&
      value.tableContent.sheets.every(
        (sheet) =>
          isObject(sheet) &&
          isString(sheet.name) &&
          Array.isArray(sheet.rows) &&
          sheet.rows.every((row) => Array.isArray(row) && row.every(isTableCell))
      ) &&
      isTableLimits(value.tableContent.limits))) &&
  isNullableString(value.imageDataUrl) &&
  isBoolean(value.visualModelAvailable) &&
  isString(value.notice);

const isImportItem = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.name) &&
  isString(value.extension) &&
  isNumber(value.sizeBytes) &&
  isString(value.capability) &&
  importCapabilities.has(value.capability) &&
  isString(value.status) &&
  importItemStatuses.has(value.status) &&
  isBoolean(value.readable) &&
  isBoolean(value.editable) &&
  isNullableString(value.reasonCode) &&
  isNullableString(value.reason) &&
  isNullableString(value.alternative) &&
  isStringArray(value.warnings);

export const isImportBatch = (value: unknown): value is ImportBatch =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.status) &&
  importBatchStatuses.has(value.status) &&
  Array.isArray(value.items) &&
  value.items.length <= 20 &&
  value.items.every(isImportItem) &&
  isNumber(value.totalSizeBytes) &&
  isNumber(value.maxFiles) &&
  isNumber(value.maxBatchBytes) &&
  isBoolean(value.canConfirm) &&
  isNullableString(value.failureCode) &&
  isNullableString(value.failureReason);

export const isImportDropOutcome = (value: unknown): value is ImportDropOutcome =>
  isObject(value) &&
  isString(value.targetId) &&
  (value.batch === null || isImportBatch(value.batch)) &&
  isNullableString(value.errorCode) &&
  isNullableString(value.errorMessage) &&
  ((value.batch !== null && value.errorCode === null && value.errorMessage === null) ||
    (value.batch === null && value.errorCode !== null && value.errorMessage !== null));

export const isResultSummary = (value: unknown): value is ResultSummary =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.workspaceId) &&
  isString(value.type) &&
  resultTypes.has(value.type) &&
  isString(value.title) &&
  isString(value.status) &&
  resultStatuses.has(value.status) &&
  isString(value.storageKind) &&
  resultStorageKinds.has(value.storageKind) &&
  isNullableString(value.currentRevisionId) &&
  isNullableString(value.a2uiSurfaceId) &&
  isString(value.createdAt) &&
  isString(value.updatedAt) &&
  isNullableString(value.completedAt);

export const isResultDetail = (value: unknown): value is ResultDetail =>
  isResultSummary(value) &&
  isObject(value) &&
  isString(value.storageRef) &&
  value.storageRef.startsWith('result://') &&
  isNullableString(value.activeSessionId) &&
  (value.managedState === null || isObject(value.managedState));

export const isResultDocument = (value: unknown): value is ResultDocument =>
  isObject(value) &&
  isResultDetail(value.result) &&
  isString(value.format) &&
  new Set(['markdown', 'plain_text']).has(value.format) &&
  isString(value.content) &&
  isString(value.contentHash) &&
  isNumber(value.sizeBytes) &&
  isBoolean(value.editable);

export const isResultRevision = (value: unknown): value is ResultRevision =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.contentHash) &&
  isString(value.source) &&
  versionSources.has(value.source) &&
  isNullableString(value.summary) &&
  isString(value.createdAt) &&
  isBoolean(value.isCurrent) &&
  isString(value.content);

const isTemplateField = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.label) &&
  isString(value.kind) &&
  templateFieldKinds.has(value.kind) &&
  isBoolean(value.required) &&
  isStringArray(value.options) &&
  (value.defaultValue === null || value.defaultValue !== undefined) &&
  isNullableNumber(value.maxLength);

export const isTaskTemplate = (value: unknown): value is TaskTemplate =>
  isObject(value) &&
  isString(value.id) &&
  isNumber(value.version) &&
  isString(value.name) &&
  isString(value.description) &&
  isString(value.kind) &&
  taskKinds.has(value.kind) &&
  value.desiredResultType === 'document' &&
  Array.isArray(value.fields) &&
  value.fields.every(isTemplateField) &&
  isStringArray(value.defaultSections) &&
  isString(value.riskLevel) &&
  patchRisks.has(value.riskLevel) &&
  isBoolean(value.builtin);

const isTaskQuestion = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.fieldId) &&
  isString(value.prompt) &&
  isString(value.kind) &&
  templateFieldKinds.has(value.kind) &&
  isStringArray(value.options) &&
  isBoolean(value.required) &&
  isNullableNumber(value.maxLength);

export const isTaskDetail = (value: unknown): value is TaskDetail =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.workspaceId) &&
  isString(value.templateId) &&
  isNumber(value.templateVersion) &&
  isString(value.kind) &&
  taskKinds.has(value.kind) &&
  value.desiredResultType === 'document' &&
  isString(value.status) &&
  taskStatuses.has(value.status) &&
  isObject(value.inputAnswers) &&
  Array.isArray(value.questions) &&
  value.questions.length <= 3 &&
  value.questions.every(isTaskQuestion) &&
  isNullableString(value.resultId) &&
  isString(value.createdAt) &&
  isString(value.updatedAt) &&
  isNullableString(value.completedAt);

export const isTaskRunResult = (value: unknown): value is TaskRunResult =>
  isObject(value) &&
  isTaskDetail(value.task) &&
  isResultDetail(value.result) &&
  value.outputMode === 'local_scaffold';

const isWorkspaceDraft = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.content) &&
  isString(value.baseHash) &&
  isString(value.updatedAt);

export const isWorkspaceDocument = (value: unknown): value is WorkspaceDocument =>
  isObject(value) &&
  isString(value.path) &&
  isString(value.name) &&
  isString(value.language) &&
  isString(value.content) &&
  isString(value.contentHash) &&
  isNumber(value.sizeBytes) &&
  (value.draft === null || isWorkspaceDraft(value.draft)) &&
  isBoolean(value.editable) &&
  isBoolean(value.extracted) &&
  (value.sourceId === null || isString(value.sourceId));

const isChatMessage = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.role) &&
  messageRoles.has(value.role) &&
  isString(value.content) &&
  isString(value.status) &&
  messageStatuses.has(value.status) &&
  isNullableString(value.requestId) &&
  isNullableString(value.providerId) &&
  isNullableString(value.errorCode) &&
  isString(value.createdAt);

export const isChatSession = (value: unknown): value is ChatSession =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.workspaceId) &&
  isString(value.title) &&
  isString(value.createdAt) &&
  isString(value.updatedAt) &&
  Array.isArray(value.messages) &&
  value.messages.every(isChatMessage);

export const isChatStreamEvent = (value: unknown): value is ChatStreamEvent => {
  if (
    !isObject(value) ||
    !isString(value.type) ||
    !isString(value.requestId) ||
    !isString(value.messageId)
  ) {
    return false;
  }
  if (value.type === 'delta') return isString(value.delta);
  if (value.type === 'complete' || value.type === 'stopped') return true;
  return (
    value.type === 'error' &&
    isString(value.code) &&
    isString(value.message) &&
    isBoolean(value.retryable) &&
    isNullableNumber(value.retryAfterSeconds)
  );
};

export const isChatStreamResult = (value: unknown): value is ChatStreamResult =>
  isObject(value) &&
  isString(value.requestId) &&
  isString(value.messageId) &&
  isString(value.content) &&
  isString(value.status) &&
  streamStatuses.has(value.status) &&
  isNullableString(value.errorCode) &&
  isNullableString(value.errorMessage) &&
  isBoolean(value.retryable) &&
  isNullableNumber(value.retryAfterSeconds) &&
  (value.patch === null || isPatchReview(value.patch)) &&
  isNullableString(value.patchError) &&
  (value.a2ui === null || isA2uiProcessResult(value.a2ui));

const documentPatchKeys = [
  'version',
  'type',
  'workspaceId',
  'baseRevision',
  'summary',
  'changes',
] as const;
const patchChangeKeys = [
  'id',
  'path',
  'operation',
  'baseHash',
  'anchor',
  'content',
  'reason',
  'risk',
] as const;
const patchAnchorKeys = ['before', 'beforeHash'] as const;

const isPatchAnchor = (value: unknown): boolean =>
  isObject(value) &&
  hasExactKeys(value, patchAnchorKeys) &&
  isString(value.before) &&
  isNullableString(value.beforeHash);

const isPatchChange = (value: unknown): boolean =>
  isObject(value) &&
  hasExactKeys(value, patchChangeKeys) &&
  isString(value.id) &&
  isString(value.path) &&
  isString(value.operation) &&
  patchOperations.has(value.operation) &&
  isNullableString(value.baseHash) &&
  isPatchAnchor(value.anchor) &&
  isString(value.content) &&
  isString(value.reason) &&
  isString(value.risk) &&
  patchRisks.has(value.risk);

export const isDocumentPatch = (value: unknown): value is DocumentPatch =>
  isObject(value) &&
  hasExactKeys(value, documentPatchKeys) &&
  value.version === '1.0' &&
  value.type === 'document_patch' &&
  isString(value.workspaceId) &&
  isNullableString(value.baseRevision) &&
  isString(value.summary) &&
  Array.isArray(value.changes) &&
  value.changes.every(isPatchChange);

const isPatchReviewChange = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.path) &&
  isString(value.operation) &&
  patchOperations.has(value.operation) &&
  isString(value.reason) &&
  isString(value.risk) &&
  patchRisks.has(value.risk) &&
  isString(value.before) &&
  isString(value.after) &&
  isBoolean(value.selected);

export const isPatchReview = (value: unknown): value is PatchReview =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.workspaceId) &&
  isString(value.summary) &&
  isDocumentPatch(value.patch) &&
  Array.isArray(value.changes) &&
  value.changes.every(isPatchReviewChange);

const isAppliedPatchFile = (value: unknown): boolean =>
  isObject(value) && isString(value.path) && isString(value.content) && isString(value.contentHash);

export const isPatchApplication = (value: unknown): value is PatchApplication =>
  isObject(value) &&
  isString(value.operationId) &&
  isString(value.summary) &&
  isNullableString(value.undoOf) &&
  Array.isArray(value.files) &&
  value.files.every(isAppliedPatchFile);

const isA2uiAction = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.type) &&
  a2uiActions.has(value.type) &&
  (value.target === undefined || isNullableString(value.target));

const isA2uiNode = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.component) &&
  a2uiComponents.has(value.component) &&
  isObject(value.props) &&
  Array.isArray(value.children) &&
  value.children.every(isA2uiNode) &&
  isObject(value.actions) &&
  Object.values(value.actions).every(isA2uiAction);

const isA2uiValidation = (value: unknown): boolean =>
  isObject(value) &&
  isBoolean(value.valid) &&
  isStringArray(value.errors) &&
  isStringArray(value.warnings) &&
  isNumber(value.durationMs);

const isA2uiSurface = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.surfaceId) &&
  isString(value.workspaceId) &&
  isString(value.sessionId) &&
  isString(value.messageId) &&
  isNumber(value.revision) &&
  isA2uiNode(value.root) &&
  isObject(value.data) &&
  isString(value.rawMessage) &&
  isA2uiValidation(value.validation) &&
  Array.isArray(value.events);

const isA2uiInspection = (value: unknown): boolean =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.messageId) &&
  isNullableString(value.surfaceId) &&
  isString(value.rawMessage) &&
  isA2uiValidation(value.validation) &&
  (value.createdAt === null || isString(value.createdAt));

export const isA2uiProcessResult = (value: unknown): value is A2uiProcessResult =>
  isObject(value) &&
  (value.surface === null || isA2uiSurface(value.surface)) &&
  isA2uiInspection(value.inspection);

export const isA2uiSurfaceProtocol = (value: unknown): boolean =>
  isObject(value) &&
  hasExactKeys(value, ['version', 'type', 'surfaceId', 'revision', 'root', 'data']) &&
  value.version === '1.0' &&
  value.type === 'a2ui_surface' &&
  isString(value.surfaceId) &&
  isNumber(value.revision) &&
  isA2uiNode(value.root) &&
  isObject(value.data);

export const isDocumentVersionSummary = (value: unknown): value is DocumentVersionSummary =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.relativePath) &&
  isString(value.contentHash) &&
  isString(value.source) &&
  versionSources.has(value.source) &&
  isNullableString(value.summary) &&
  isString(value.versionKind) &&
  versionKinds.has(value.versionKind) &&
  isString(value.createdAt) &&
  isBoolean(value.isCurrent);

export const isDocumentVersion = (value: unknown): value is DocumentVersion => {
  if (!isObject(value)) return false;
  const document = value;
  return isDocumentVersionSummary(document) && isString(document.content);
};

export const isAppErrorContract = (value: unknown): value is AppErrorContract =>
  isObject(value) &&
  isString(value.code) &&
  isString(value.message) &&
  isBoolean(value.retryable) &&
  isNullableNumber(value.httpStatus) &&
  isNullableNumber(value.retryAfterSeconds);
