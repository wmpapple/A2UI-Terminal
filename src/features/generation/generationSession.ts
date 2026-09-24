import type { ReviewRequest } from '../../shared/types/domain';
import type { GenerationPlan } from '../../shared/types/generation';

export interface GenerationSessionDraft {
  prompt: string;
  knowledgeIds: string[];
  documentIds: string[];
  packIds: string[];
  includeResult: boolean;
  sentPlan: GenerationPlan | null;
  text: string;
  applied: ReviewRequest | null;
}

interface ApprovedScope {
  fingerprint: string;
  sensitiveConfirmed: boolean;
}

const MAX_SESSIONS = 32;
const drafts = new Map<string, GenerationSessionDraft>();
const approvals = new Map<string, ApprovedScope>();

const keepBounded = <T>(map: Map<string, T>, key: string, value: T) => {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_SESSIONS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
};

export const generationSessionKey = (workspaceId: string, resultId?: string, taskId?: string) =>
  resultId ? `result:${resultId}` : taskId ? `task:${taskId}` : `workspace:${workspaceId}`;

export const readGenerationSession = (key: string): GenerationSessionDraft | null => {
  const value = drafts.get(key);
  return value
    ? {
        ...value,
        knowledgeIds: [...value.knowledgeIds],
        documentIds: [...value.documentIds],
        packIds: [...value.packIds],
      }
    : null;
};

export const writeGenerationSession = (key: string, value: GenerationSessionDraft) =>
  keepBounded(drafts, key, {
    ...value,
    knowledgeIds: [...value.knowledgeIds],
    documentIds: [...value.documentIds],
    packIds: [...value.packIds],
  });

const scopeFingerprint = (plan: GenerationPlan, providerSignature: string) => {
  const sources = plan.manifest.includedSources
    .map((source) => ({
      kind: source.kind,
      sourceRef: source.sourceRef,
      contentHash: source.contentHash,
      sizeBytes: source.sizeBytes,
      characterCount: source.characterCount,
      mode: source.mode,
      selectedRanges: [...source.selectedRanges].sort((a, b) =>
        `${a.chunkId}:${a.startCharacter}:${a.endCharacter}`.localeCompare(
          `${b.chunkId}:${b.startCharacter}:${b.endCharacter}`
        )
      ),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({
    providerSignature,
    providerId: plan.manifest.providerId,
    processingLocation: plan.manifest.processingLocation,
    strategy: plan.manifest.strategy,
    indexMode: plan.manifest.indexMode,
    requiresSensitiveConfirmation: plan.manifest.requiresSensitiveConfirmation,
    sources,
  });
};

export const rememberGenerationScope = (
  key: string,
  plan: GenerationPlan,
  providerSignature: string,
  sensitiveConfirmed: boolean
) =>
  keepBounded(approvals, key, {
    fingerprint: scopeFingerprint(plan, providerSignature),
    sensitiveConfirmed,
  });

export const approvedSensitiveConfirmation = (
  key: string,
  plan: GenerationPlan,
  providerSignature: string
): boolean | null => {
  const approval = approvals.get(key);
  if (!approval || approval.fingerprint !== scopeFingerprint(plan, providerSignature)) return null;
  return approval.sensitiveConfirmed;
};

export const clearGenerationSessionsForTests = () => {
  drafts.clear();
  approvals.clear();
};
