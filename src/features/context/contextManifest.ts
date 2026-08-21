import type {
  ContextCandidate,
  ContextManifest,
  ContextManifestInput,
  ContextManifestSource,
  ContextSelection,
  DocumentSource,
  ProcessingLocation,
  ProviderConfig,
  WorkspaceFile,
} from '../../shared/types/domain';
import { estimateContextTokens } from './tokenEstimate';

interface ManifestInputOptions {
  workspaceId: string;
  sessionId: string;
  providerId: string;
  prompt: string;
  selection: ContextSelection;
  files: WorkspaceFile[];
  documentSources: DocumentSource[];
  activePath: string;
  selectedText: string;
}

export const processingLocationForProvider = (
  provider: ProviderConfig | undefined
): ProcessingLocation => {
  const endpoint = provider?.endpoint.trim().toLowerCase() ?? '';
  return /^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/.test(endpoint)
    ? 'local'
    : 'cloud';
};

export const buildContextManifestInput = ({
  workspaceId,
  sessionId,
  providerId,
  prompt,
  selection,
  files,
  documentSources,
  activePath,
  selectedText,
}: ManifestInputOptions): ContextManifestInput => {
  const candidates: ContextCandidate[] = [];
  const active = files.find((file) => file.path === activePath);
  const selectedDocumentSourceIds = new Set(selection.documentSourceIds ?? []);
  if (selectedText || selection.selection) {
    candidates.push({
      kind: 'selection',
      label: activePath || '当前选区',
      selected: selection.selection && Boolean(selectedText),
      sourceId: active?.sourceId,
      content: selection.selection ? selectedText : undefined,
      baseHash: active?.contentHash,
    });
  }
  const seenSourceIds = new Set<string>();
  for (const file of files) {
    const selected =
      (file.path === activePath && selection.currentFile) ||
      selection.projectFiles.includes(file.path) ||
      Boolean(file.sourceId && selectedDocumentSourceIds.has(file.sourceId));
    candidates.push({
      kind:
        file.path === activePath
          ? 'current_file'
          : file.extracted
            ? 'attached_document'
            : 'project_file',
      label: file.path,
      selected,
      sourceId: file.sourceId,
      content: selected ? file.content : undefined,
      baseHash: file.contentHash,
    });
    if (file.sourceId) seenSourceIds.add(file.sourceId);
  }
  for (const source of documentSources) {
    if (seenSourceIds.has(source.id)) continue;
    candidates.push({
      kind: 'attached_document',
      label: source.name,
      selected: (selection.documentSourceIds ?? []).includes(source.id),
      sourceId: source.id,
      baseHash: source.contentHash,
    });
  }
  return {
    workspaceId,
    sessionId,
    providerId,
    prompt,
    candidates,
    includeRecentMessages: selection.recentMessages,
    recentMessageCount: selection.recentMessages ? selection.recentMessageCount : 0,
  };
};

export const createWebMockManifest = (
  input: ContextManifestInput,
  processingLocation: ProcessingLocation
): ContextManifest => {
  const selectedCandidates = input.candidates.filter((candidate) => candidate.selected);
  const selectedCharacters = selectedCandidates.reduce(
    (sum, candidate) => sum + (candidate.content?.length ?? 0),
    0
  );
  const hasShortPrioritySource = selectedCandidates.some(
    (candidate) =>
      (candidate.kind === 'selection' || candidate.kind === 'current_file') &&
      (candidate.content?.length ?? 0) <= 12000
  );
  const strategy =
    selectedCharacters <= 24000
      ? ('full' as const)
      : hasShortPrioritySource
        ? ('hybrid' as const)
        : ('retrieval' as const);
  const includedSources: ContextManifestSource[] = selectedCandidates.map((candidate) => ({
    kind: candidate.kind,
    label: candidate.label,
    sourceRef: candidate.sourceId ?? null,
    contentHash: candidate.baseHash ?? null,
    sizeBytes: candidate.content?.length ?? 0,
    characterCount: candidate.content?.length ?? 0,
    mode:
      strategy === 'full' ||
      ((candidate.kind === 'selection' || candidate.kind === 'current_file') &&
        (candidate.content?.length ?? 0) <= 12000)
        ? ('full' as const)
        : ('retrieved' as const),
    selectedRanges: candidate.content
      ? [{ chunkId: 'full', startCharacter: 0, endCharacter: candidate.content.length }]
      : [],
    exclusionReason: null,
  }));
  const excludedSources: ContextManifestSource[] = input.candidates
    .filter((candidate) => !candidate.selected)
    .map((candidate) => ({
      kind: candidate.kind,
      label: candidate.label,
      sourceRef: candidate.sourceId ?? null,
      contentHash: null,
      sizeBytes: 0,
      characterCount: 0,
      mode: 'excluded' as const,
      selectedRanges: [],
      exclusionReason: '用户未选择',
    }));
  if (input.includeRecentMessages) {
    includedSources.push({
      kind: 'recent_messages',
      label: `最近 ${input.recentMessageCount} 条对话`,
      sourceRef: null,
      contentHash: null,
      sizeBytes: 0,
      characterCount: 0,
      mode: 'full',
      selectedRanges: [],
      exclusionReason: null,
    });
  }
  const now = Math.floor(Date.now() / 1000);
  return {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    providerId: input.providerId,
    processingLocation,
    strategy,
    indexMode: strategy === 'full' ? 'none' : 'memory_lexical',
    status: 'awaiting_confirmation',
    includedSources,
    excludedSources,
    characterCount: includedSources.reduce((sum, source) => sum + source.characterCount, 0),
    estimatedTokens:
      estimateContextTokens(input.prompt) +
      includedSources.reduce(
        (sum, source) =>
          sum +
          estimateContextTokens(
            selectedCandidates.find((candidate) => candidate.label === source.label)?.content ?? ''
          ),
        0
      ) +
      2048,
    tokenBudget: 32000,
    retrievedChunkCount: includedSources
      .filter((source) => source.mode === 'retrieved')
      .reduce((sum, source) => sum + source.selectedRanges.length, 0),
    sensitiveWarning: false,
    requiresSensitiveConfirmation: false,
    createdAt: String(now),
    expiresAt: String(now + 600),
    confirmedAt: null,
  };
};
