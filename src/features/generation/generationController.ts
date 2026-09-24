import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';
import type { ChatStreamEvent, ReviewRequest, ResultDocument } from '../../shared/types/domain';
import type { GenerationPlan, PlanGenerationInput } from '../../shared/types/generation';
import { resultController } from '../results/resultController';
import { reviewController } from '../diff/reviewController';
import { knowledgeController } from '../knowledge/knowledgeController';
import { contextPackController } from '../contextPacks/contextPackController';
import { importController } from '../imports/importController';
import { createWebMockManifest } from '../context/contextManifest';
import {
  webMockHomeGateway,
  createWebMockReviewResult,
  getWebMockGenerationTask,
  completeWebMockGenerationTask,
} from '../../shared/mock/home';

const plans = new Map<
  string,
  { input: PlanGenerationInput; plan: GenerationPlan; before?: ResultDocument; confirmed: boolean }
>();
const reviews = new Map<
  string,
  { review: ReviewRequest; before?: ResultDocument; taskId?: string; afterHash?: string }
>();
const stopped = new Set<string>();

export const generationController = {
  async plan(input: PlanGenerationInput): Promise<GenerationPlan> {
    if (!isWebMock()) return desktopGateway.planGeneration(input);
    const before = input.resultId ? await resultController.open(input.resultId) : undefined;
    const task = input.taskId ? getWebMockGenerationTask(input.taskId) : undefined;
    const workspaceId = before?.result.workspaceId ?? task?.workspaceId ?? 'web-mock-workspace';
    const candidates = [];
    if (before && input.includeResult)
      candidates.push({
        kind: 'selection' as const,
        label: `当前成果：${before.result.title}`,
        selected: true,
        content: before.content,
      });
    const packs = await contextPackController.list(workspaceId);
    const knowledgeIds = new Set(input.knowledgeIds);
    const documentIds = new Set(input.documentSourceIds);
    for (const pack of packs.filter((p) => input.contextPackIds.includes(p.id)))
      for (const item of pack.items) {
        if (item.personalKnowledge) knowledgeIds.add(item.sourceId);
        else documentIds.add(item.sourceId);
      }
    const authorized = await importController.listSources(workspaceId);
    for (const id of documentIds) {
      const source = authorized.find((s) => s.id === id && s.kind === 'text');
      if (!source) throw new Error('资料不属于目标工作区或不支持正文发送');
      const document = await importController.readSource(id);
      candidates.push({
        kind: 'attached_document' as const,
        label: source.name,
        sourceId: id,
        selected: true,
        content: document.textContent ?? '',
      });
    }
    for (const id of knowledgeIds) {
      const doc = await knowledgeController.get(id);
      candidates.push({
        kind: 'personal_knowledge' as const,
        label: doc.source.title,
        sourceId: id,
        selected: true,
        content: doc.parsed.blocks.map((b) => b.text).join('\n'),
      });
    }
    const manifest = createWebMockManifest(
      {
        workspaceId,
        sessionId: crypto.randomUUID(),
        providerId: input.providerId,
        prompt: input.prompt,
        candidates,
        includeRecentMessages: false,
        recentMessageCount: 0,
        contextPackIds: input.contextPackIds,
      },
      'cloud',
      packs
    );
    const plan = {
      id: manifest.id,
      requestId: crypto.randomUUID(),
      manifest,
      targetTitle: before?.result.title ?? '任务成果',
      prompt: input.prompt,
    };
    plans.clear();
    plans.set(plan.id, { input, plan, before, confirmed: false });
    return plan;
  },
  async confirm(id: string, sensitive: boolean) {
    if (!isWebMock()) return desktopGateway.confirmContextManifest(id, sensitive);
    const pending = plans.get(id);
    if (!pending) throw new Error('请重新规划资料');
    if (pending.plan.manifest.requiresSensitiveConfirmation && !sensitive)
      throw new Error('请确认敏感资料发送');
    pending.confirmed = true;
  },
  async start(id: string, onEvent: (event: ChatStreamEvent) => void) {
    if (!isWebMock()) return desktopGateway.startGeneration(id, onEvent);
    const pending = plans.get(id);
    plans.delete(id);
    if (!pending?.confirmed) throw new Error('请先确认发送范围');
    const { plan, input, before } = pending;
    const content = `# ${plan.targetTitle}\n\nWeb Mock 示例：${input.prompt}\n\n这是模拟候选正文，不代表真实模型输出。`;
    for (const delta of content.match(/.{1,12}/gs) ?? []) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      if (stopped.has(plan.requestId)) throw new Error('生成已停止，未修改成果');
      onEvent({ type: 'delta', requestId: plan.requestId, messageId: plan.requestId, delta });
    }
    if (
      before &&
      (await resultController.open(before.result.id)).contentHash !== before.contentHash
    )
      throw new Error('成果已变化，请重新生成');
    const review: ReviewRequest = {
      id: crypto.randomUUID(),
      workspaceId: plan.manifest.workspaceId,
      resultId: input.resultId,
      source: input.taskId ? 'template' : 'chat',
      operationKind: input.resultId ? 'replace_result' : 'create_file',
      status: 'pending',
      summary: 'AI 写作提案',
      risk: 'high',
      baseRevisionId: before?.result.currentRevisionId ?? null,
      baseHash: before?.contentHash ?? null,
      blocks: [
        {
          id: crypto.randomUUID(),
          kind: input.resultId ? 'replace_result' : 'create_file',
          status: 'pending',
          targetLabel: plan.targetTitle,
          operation: 'replace',
          before: before?.content ?? '',
          after: content,
          reason: '请审阅后决定',
          risk: 'high',
          suggestedFileName: input.taskId ? 'generated.md' : null,
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
    reviews.set(review.id, { review, before, taskId: input.taskId ?? undefined });
    return { review };
  },
  async stop(requestId: string) {
    if (!isWebMock()) return desktopGateway.stopChat(requestId);
    stopped.add(requestId);
    return true;
  },
  async apply(review: ReviewRequest, fileName: string) {
    if (!isWebMock()) {
      const current = await reviewController.get(review.id);
      if (current.status === 'applied')
        return reviewController.apply(current.id, current.workspaceId);
      const accepted = await reviewController.decide(
        review.id,
        review.workspaceId,
        review.blocks.map((b) => ({
          blockId: b.id,
          accepted: true,
          fileName: b.kind === 'create_file' ? fileName : undefined,
        }))
      );
      return reviewController.apply(accepted.id, accepted.workspaceId);
    }
    const stored = reviews.get(review.id);
    if (!stored) throw new Error('提案已失效');
    const document = stored.before
      ? await resultController.save(
          stored.before.result.id,
          review.blocks[0].after,
          stored.before.contentHash
        )
      : await createWebMockReviewResult({
          reviewId: review.id,
          workspaceId: review.workspaceId,
          title: review.blocks[0].targetLabel,
          fileName,
          format: 'markdown',
          content: review.blocks[0].after,
        });
    stored.review = { ...review, status: 'applied', outputResultId: document.result.id };
    stored.afterHash = document.contentHash;
    if (stored.taskId) completeWebMockGenerationTask(stored.taskId, document.result.id);
    return {
      reviewId: review.id,
      status: 'applied' as const,
      operationId: null,
      files: [],
      result: document,
    };
  },
  async discard(review: ReviewRequest) {
    if (!isWebMock()) return reviewController.discard(review.workspaceId, review.id);
    reviews.delete(review.id);
  },
  async undo(review: ReviewRequest) {
    if (!isWebMock()) return reviewController.undoReview(review.id, review.workspaceId);
    const stored = reviews.get(review.id);
    if (!stored?.before || !stored.afterHash) throw new Error('请使用成果历史版本恢复');
    const result = await webMockHomeGateway.saveResultDocument(
      stored.before.result.id,
      stored.before.content,
      stored.afterHash
    );
    reviews.delete(review.id);
    return { reviewId: review.id, status: 'undone' as const, operationId: null, files: [], result };
  },
};
