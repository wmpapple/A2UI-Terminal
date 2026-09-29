import type {
  WritingProject,
  WritingRun,
  SaveProjectInput,
  SaveOutlineInput,
  PlanWritingInput,
  WritingPlan,
  AcceptSectionInput,
} from '../../shared/types/writingProject';
import { createWebMockManifest } from '../context/contextManifest';
import { createWebMockReviewResult } from '../../shared/mock/home';
import { knowledgeController } from '../knowledge/knowledgeController';
import { writingProfileController } from '../settings/writingProfileController';
import { importController } from '../imports/importController';
import { contextPackController } from '../contextPacks/contextPackController';
import type { ContextCandidate } from '../../shared/types/domain';

const key = 'a2ui.web-mock.writing-projects.v1';
const read = (): { projects: WritingProject[]; runs: WritingRun[] } =>
  JSON.parse(localStorage.getItem(key) ?? '{"projects":[],"runs":[]}');
const write = (data: ReturnType<typeof read>) => localStorage.setItem(key, JSON.stringify(data));
const plans = new Map<string, { plan: WritingPlan; input: PlanWritingInput; confirmed: boolean }>();
const stopped = new Set<string>();
function get(id: string) {
  const p = read().projects.find((p) => p.id === id);
  if (!p) throw Error('项目不存在');
  return p;
}
function save(p: WritingProject) {
  const data = read();
  data.projects = data.projects.filter((v) => v.id !== p.id);
  data.projects.unshift(p);
  write(data);
  return p;
}
function requireRevision(p: WritingProject, revision: number | null) {
  if (
    p.revision !== revision ||
    read().runs.some((r) => r.projectId === p.id && r.status === 'running')
  )
    throw Error('项目已变化或正在生成');
}
export const writingProjectMock = {
  async listWritingProjects(workspaceId: string) {
    return read().projects.filter((p) => p.workspaceId === workspaceId);
  },
  async getWritingProject(projectId: string) {
    return { project: get(projectId), runs: read().runs.filter((r) => r.projectId === projectId) };
  },
  async saveWritingProject(input: SaveProjectInput) {
    if (!input.config.title.trim() || !input.config.goal.trim())
      throw Error('请填写标题和写作目标');
    if (input.id) {
      const p = get(input.id);
      requireRevision(p, input.revision);
      p.config = input.config;
      p.revision++;
      p.outlineConfirmed = false;
      p.sections.forEach((s) => (s.accepted = false));
      return save(p);
    }
    return save({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      revision: 1,
      config: input.config,
      outlineConfirmed: false,
      sections: [],
      resultId: null,
      finalReviewId: null,
    });
  },
  async saveWritingOutline(input: SaveOutlineInput) {
    const p = get(input.projectId);
    requireRevision(p, input.revision);
    if (!input.sections.length) throw Error('请添加章节');
    p.sections = input.sections.map((s) => ({
      content: '',
      summary: '',
      runId: null,
      requestId: null,
      ...p.sections.find((v) => v.id === s.id),
      accepted: false,
      ...s,
      id: s.id ?? crypto.randomUUID(),
    }));
    p.outlineConfirmed = input.confirmed;
    p.revision++;
    return save(p);
  },
  async readWritingOutlineProposal(runId: string) {
    const r = read().runs.find((r) => r.id === runId);
    return JSON.parse(r?.content ?? '{}').sections;
  },
  async planWritingRun(input: PlanWritingInput) {
    const p = get(input.projectId);
    requireRevision(p, input.revision);
    if (input.sectionId && !p.outlineConfirmed) throw Error('请先确认大纲');
    const candidates: ContextCandidate[] = [];
    for (const id of p.config.knowledgeIds) {
      const d = await knowledgeController.get(id);
      candidates.push({
        kind: 'personal_knowledge',
        label: d.source.title,
        sourceId: id,
        selected: true,
        content: d.parsed.blocks.map((b) => b.text).join('\n'),
      });
    }
    for (const id of p.config.documentSourceIds) {
      const d = await importController.readSource(id);
      candidates.push({
        kind: 'attached_document',
        label: d.source.name,
        sourceId: id,
        selected: true,
        content: d.textContent ?? (d.tableContent ? JSON.stringify(d.tableContent) : ''),
      });
    }
    const prompt = `${p.config.goal}\n${p.config.facts}\n${input.instruction}`;
    const manifest = createWebMockManifest(
      {
        workspaceId: p.workspaceId,
        sessionId: crypto.randomUUID(),
        providerId: input.providerId,
        prompt,
        candidates,
        includeRecentMessages: false,
        recentMessageCount: 0,
        contextPackIds: p.config.contextPackIds,
      },
      'cloud',
      await contextPackController.list(p.workspaceId),
      (await writingProfileController.get(p.workspaceId)).effective
    );
    const plan = { id: manifest.id, requestId: crypto.randomUUID(), manifest, prompt };
    plans.set(plan.id, { plan, input, confirmed: false });
    return plan;
  },
  async confirm(id: string, sensitive: boolean) {
    const entry = plans.get(id);
    if (!entry || (entry.plan.manifest.requiresSensitiveConfirmation && !sensitive))
      throw Error('请确认发送范围');
    entry.confirmed = true;
  },
  async startWritingRun(id: string) {
    const entry = plans.get(id);
    if (!entry?.confirmed) throw Error('请先确认');
    plans.delete(id);
    const { input, plan } = entry;
    const p = get(input.projectId);
    requireRevision(p, input.revision);
    const run: WritingRun = {
      id: plan.requestId,
      projectId: p.id,
      sectionId: input.sectionId,
      projectRevision: p.revision,
      requestId: plan.requestId,
      status: 'running',
      content: '',
      error: null,
      snapshot: { promptVersion: 'web-mock', prompt: plan.prompt, manifest: plan.manifest },
      createdAt: new Date().toISOString(),
      draft: null,
    };
    let data = read();
    data.runs.unshift(run);
    write(data);
    await new Promise((resolve) => setTimeout(resolve, 350));
    run.status = stopped.has(run.id) ? 'cancelled' : 'review';
    run.content = input.sectionId
      ? `Web Mock 示例正文：${p.sections.find((s) => s.id === input.sectionId)?.title}。\n\n${p.config.facts || '这里展示章节审阅流程，不代表真实模型输出。'}`
      : JSON.stringify({
          sections: [
            { id: null, title: '背景与目标', objective: '解释背景及关键事实', targetWords: 500 },
            { id: null, title: '行动建议', objective: '提出有依据的后续行动', targetWords: 500 },
          ],
        });
    data = read();
    data.runs = data.runs.map((r) => (r.id === run.id ? run : r));
    write(data);
    return run;
  },
  async cancelWritingRun(id: string) {
    plans.delete(id);
    stopped.add(id);
  },
  async acceptWritingSection(input: AcceptSectionInput) {
    const p = get(input.projectId);
    requireRevision(p, input.revision);
    const s = p.sections.find((s) => s.id === input.sectionId);
    if (!s || !input.summary.trim() || !input.content.trim()) throw Error('请填写正文和摘要');
    s.content = input.content;
    s.summary = input.summary;
    s.accepted = true;
    s.runId = input.runId;
    s.requestId = input.runId;
    p.sections.slice(p.sections.indexOf(s) + 1).forEach((s) => (s.accepted = false));
    p.revision++;
    return save(p);
  },
  async finalizeWritingProject(id: string, revision: number) {
    const p = get(id);
    if (p.resultId) return p.resultId;
    requireRevision(p, revision);
    if (!p.sections.length || p.sections.some((s) => !s.accepted)) throw Error('请接受全部章节');
    const result = await createWebMockReviewResult({
      title: p.config.title,
      fileName: 'longform.md',
      workspaceId: p.workspaceId,
      reviewId: p.id,
      format: 'markdown',
      content:
        `# ${p.config.title}\n\n` +
        p.sections.map((s) => `## ${s.title}\n\n${s.content}`).join('\n\n'),
    });
    p.resultId = result.result.id;
    p.finalReviewId = p.id;
    p.revision++;
    save(p);
    return p.resultId;
  },
  async deleteWritingProject(id: string) {
    const d = read();
    d.projects = d.projects.filter((p) => p.id !== id);
    d.runs = d.runs.filter((r) => r.projectId !== id);
    write(d);
  },
  async saveWritingDraft(runId: string, content: string, summary: string) {
    const d = read();
    const r = d.runs.find((r) => r.id === runId);
    if (r) r.draft = { content, summary };
    write(d);
  },
};
