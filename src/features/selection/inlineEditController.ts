import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';
import type { InlineEditAction, SelectionSnapshot } from '../../shared/types/document';
import type {
  ChatStreamEvent,
  InlineEditPlan,
  ReviewApplication,
  ReviewRequest,
} from '../../shared/types/domain';
import { reviewController } from '../diff/reviewController';

interface PlanInput {
  selection: SelectionSnapshot;
  providerId: string;
  action: InlineEditAction;
  customInstruction?: string | null;
  selectedText?: string;
  documentText?: string;
  targetLabel?: string;
}

interface WebPlan {
  input: PlanInput;
  plan: InlineEditPlan;
}

const webPlans = new Map<string, WebPlan>();
const webApplications = new Map<
  string,
  { path: string; content: string; contentHash: string; review: ReviewRequest }
>();

const digest = async (text: string) => {
  const value = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const replacementFor = (action: InlineEditAction, selected: string, custom?: string | null) => {
  if (action === 'custom') return `${selected}（${custom?.trim() || '已修改'}）`;
  const labels: Record<Exclude<InlineEditAction, 'custom'>, string> = {
    polish: '已润色',
    shorten: '已精简',
    expand: '已扩写',
    professional: '更专业',
    natural: '更自然',
    grammar: '语法已修正',
    translate: 'translated',
  };
  return `${selected}（${labels[action]}）`;
};

export const inlineEditController = {
  async plan(input: PlanInput): Promise<InlineEditPlan> {
    if (!isWebMock()) {
      return desktopGateway.planInlineEdit({
        selection: input.selection,
        providerId: input.providerId,
        action: input.action,
        customInstruction: input.customInstruction,
      });
    }
    const id = crypto.randomUUID();
    const workspaceId =
      input.selection.target.kind === 'workspace_file'
        ? input.selection.target.workspaceId
        : 'web-mock-workspace';
    const plan = {
      id,
      requestId: crypto.randomUUID(),
      manifest: {
        id,
        workspaceId,
        sessionId: crypto.randomUUID(),
        providerId: input.providerId,
        processingLocation: 'local',
        strategy: 'full',
        indexMode: 'none',
        status: 'confirmed',
        writingProfile: {
          hash: 'web-mock-profile',
          composerVersion: 'm2.1',
          enabled: false,
          layers: [],
          terminology: [],
          forbiddenWords: [],
          exampleKnowledgeIds: [],
          instructionText: '',
          estimatedTokens: 0,
        },
        includedSources: [],
        excludedSources: [],
        characterCount: input.selectedText?.length ?? 0,
        estimatedTokens: 0,
        tokenBudget: 32_000,
        retrievedChunkCount: 0,
        sensitiveWarning: false,
        requiresSensitiveConfirmation: false,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        confirmedAt: new Date().toISOString(),
      },
    } as InlineEditPlan;
    webPlans.clear();
    webPlans.set(id, { input, plan });
    return plan;
  },

  async confirm(planId: string, sensitive: boolean) {
    if (!isWebMock()) return desktopGateway.confirmContextManifest(planId, sensitive);
    if (!webPlans.has(planId)) throw new Error('行内修改计划已失效，请重新选择文字。');
  },

  async start(planId: string, onEvent: (event: ChatStreamEvent) => void) {
    if (!isWebMock()) return desktopGateway.startInlineEdit(planId, onEvent);
    const prepared = webPlans.get(planId);
    webPlans.delete(planId);
    if (!prepared) throw new Error('行内修改计划已失效，请重新选择文字。');
    const { input, plan } = prepared;
    const selected = input.selectedText ?? '';
    const replacement = replacementFor(input.action, selected, input.customInstruction);
    onEvent({
      type: 'delta',
      requestId: plan.requestId,
      messageId: plan.requestId,
      delta: replacement,
    });
    const document = input.documentText ?? selected;
    const content =
      document.slice(0, input.selection.start) + replacement + document.slice(input.selection.end);
    const contentHash = await digest(content);
    const review: ReviewRequest = {
      id: crypto.randomUUID(),
      workspaceId: plan.manifest.workspaceId,
      resultId: input.selection.target.kind === 'result' ? input.selection.target.resultId : null,
      source: 'selection',
      operationKind: 'replace_result',
      status: 'pending',
      summary: '选区内 AI 修改',
      risk: 'low',
      baseRevisionId: input.selection.revisionId,
      baseHash: input.selection.contentHash,
      blocks: [
        {
          id: crypto.randomUUID(),
          kind: 'replace_result',
          status: 'pending',
          targetLabel: input.targetLabel ?? '当前文档',
          operation: 'replace_selection',
          before: selected,
          after: replacement,
          reason: 'Web Mock 行内修改建议',
          risk: 'low',
          suggestedFileName: null,
          decidedFileName: null,
        },
      ],
      applicationOperationId: null,
      outputResultId: null,
      errorCode: null,
      createdAt: new Date().toISOString(),
      decidedAt: null,
      appliedAt: null,
    };
    webApplications.set(review.id, {
      path: input.targetLabel ?? '当前文档',
      content,
      contentHash,
      review,
    });
    return { review, selection: input.selection, replacement };
  },

  async discard(review: ReviewRequest) {
    if (!isWebMock()) return reviewController.discard(review.workspaceId, review.id);
    webApplications.delete(review.id);
  },

  async accept(review: ReviewRequest): Promise<ReviewApplication> {
    if (!isWebMock()) {
      await reviewController.decide(review.id, review.workspaceId, [
        { blockId: review.blocks[0].id, accepted: true },
      ]);
      return reviewController.apply(review.id, review.workspaceId);
    }
    const stored = webApplications.get(review.id);
    if (!stored) throw new Error('行内修改建议已失效。');
    webApplications.delete(review.id);
    return {
      reviewId: review.id,
      status: 'applied',
      operationId: crypto.randomUUID(),
      files: [{ path: stored.path, content: stored.content, contentHash: stored.contentHash }],
      result: null,
    };
  },
};
