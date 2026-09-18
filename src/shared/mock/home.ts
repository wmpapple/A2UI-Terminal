import type {
  CreateTextResultInput,
  ExportProgressEvent,
  ExportResultInput,
  ExportResultOutput,
  ResultDetail,
  ResultDocument,
  ResultRecoveryDraft,
  ResultRevision,
  ResultRevisionSummary,
  ResultSummary,
  SearchAuthorizedContentInput,
  SearchAuthorizedContentOutput,
  ResultType,
  RecoveryStatus,
  TaskDetail,
  TaskQuestion,
  TaskRunResult,
  TaskTemplate,
  TextResultFormat,
} from '../types/domain';

import { exportExtension, exportFormatsFor } from '../types/exportFormats';

const activeExports = new Map<string, { cancelled: boolean; committing: boolean }>();
const exportTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

const templates: TaskTemplate[] = [
  {
    id: 'meeting_minutes',
    version: 1,
    name: '会议纪要',
    description: '把已授权的会议资料整理为结构清晰的纪要草稿。',
    kind: 'organize',
    desiredResultType: 'document',
    fields: [
      {
        id: 'meetingTitle',
        label: '会议主题',
        kind: 'short_text',
        required: true,
        options: [],
        defaultValue: null,
        maxLength: 120,
      },
      {
        id: 'audience',
        label: '阅读对象',
        kind: 'short_text',
        required: false,
        options: [],
        defaultValue: '参会人员',
        maxLength: 80,
      },
    ],
    defaultSections: ['会议信息', '核心结论', '讨论要点', '行动项', '待确认事项'],
    riskLevel: 'low',
    builtin: true,
  },
  {
    id: 'document_summary',
    version: 1,
    name: '文档总结',
    description: '把已授权的文档资料整理为面向指定用途的摘要草稿。',
    kind: 'analyze',
    desiredResultType: 'document',
    fields: [
      {
        id: 'summaryPurpose',
        label: '总结用途',
        kind: 'select',
        required: true,
        options: ['快速阅读', '决策支持', '汇报分享'],
        defaultValue: null,
        maxLength: null,
      },
      {
        id: 'length',
        label: '篇幅',
        kind: 'select',
        required: false,
        options: ['简短', '标准', '详细'],
        defaultValue: '标准',
        maxLength: null,
      },
    ],
    defaultSections: ['内容概览', '关键观点', '重要事实', '结论与建议', '待核实事项'],
    riskLevel: 'low',
    builtin: true,
  },
  {
    id: 'weekly_report',
    version: 1,
    name: '周报',
    description: '把已授权的本周资料整理为周报草稿。',
    kind: 'organize',
    desiredResultType: 'document',
    fields: [
      {
        id: 'reportPeriod',
        label: '报告周期',
        kind: 'short_text',
        required: true,
        options: [],
        defaultValue: null,
        maxLength: 80,
      },
    ],
    defaultSections: ['本周完成', '关键进展', '问题与风险', '下周计划', '需要支持'],
    riskLevel: 'low',
    builtin: true,
  },
  {
    id: 'resume_optimization',
    version: 1,
    name: '简历优化',
    description: '基于已授权的简历资料生成面向目标岗位的优化草稿。',
    kind: 'modify',
    desiredResultType: 'document',
    fields: [
      {
        id: 'targetRole',
        label: '目标岗位',
        kind: 'short_text',
        required: true,
        options: [],
        defaultValue: null,
        maxLength: 120,
      },
    ],
    defaultSections: ['个人概述', '核心能力', '工作经历', '项目经历', '教育与技能', '待补充信息'],
    riskLevel: 'medium',
    builtin: true,
  },
];

const initialResults: ResultSummary[] = [
  {
    id: 'web-mock-result-existing',
    workspaceId: 'web-mock-workspace',
    type: 'document',
    title: 'A2UI 调研纪要',
    status: 'ready',
    storageKind: 'managed_local',
    currentRevisionId: 'web-mock-revision-existing',
    a2uiSurfaceId: null,
    createdAt: '2026-08-16 09:00:00',
    updatedAt: '2026-08-17 08:30:00',
    completedAt: null,
  },
];

let results = [...initialResults];
let tasks = new Map<string, TaskDetail>();
let sequence = 0;

interface MockResultRecord {
  detail: ResultDetail;
  format: TextResultFormat;
  fileName: string;
  content: string;
  revisions: ResultRevision[];
  appliedReview: ResultDocument['appliedReview'];
}

const mockHash = (content: string) => {
  let value = 2166136261;
  for (const character of content) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return Math.abs(value >>> 0)
    .toString(16)
    .padStart(8, '0')
    .repeat(8);
};

const initialContent = '# A2UI 调研纪要\n\n这是一个可重开的确定性 Web Mock 成果。\n';
const initialDetail: ResultDetail = {
  ...initialResults[0],
  storageRef: 'result://file/web-mock-result-existing',
  activeSessionId: null,
  managedState: { format: 'markdown' },
};
const initialRecords = () =>
  new Map<string, MockResultRecord>([
    [
      initialDetail.id,
      {
        detail: initialDetail,
        format: 'markdown',
        fileName: 'A2UI 调研纪要.md',
        content: initialContent,
        appliedReview: null,
        revisions: [
          {
            id: 'web-mock-revision-existing',
            contentHash: mockHash(initialContent),
            source: 'initial',
            summary: '创建成果',
            createdAt: initialDetail.createdAt,
            isCurrent: true,
            content: initialContent,
          },
        ],
      },
    ],
  ]);

let resultRecords = initialRecords();
const resultDrafts = new Map<string, ResultRecoveryDraft>();

const clone = <T>(value: T): T => structuredClone(value);

const documentFor = (record: MockResultRecord): ResultDocument => ({
  result: clone(record.detail),
  format: record.format,
  content: record.content,
  contentHash: mockHash(record.content),
  sizeBytes: new TextEncoder().encode(record.content).length,
  editable: true,
  appliedReview: clone(record.appliedReview),
  recoveryDraft: clone(resultDrafts.get(record.detail.id) ?? null),
});

const requireRecord = (resultId: string) => {
  const record = resultRecords.get(resultId);
  if (!record) throw new Error('找不到指定成果');
  return record;
};

const questionsFor = (template: TaskTemplate, answers: Record<string, unknown>): TaskQuestion[] =>
  template.fields
    .filter((field) => field.required && !String(answers[field.id] ?? '').trim())
    .slice(0, 3)
    .map((field) => ({
      fieldId: field.id,
      prompt: `请提供${field.label}`,
      kind: field.kind,
      options: field.options,
      required: field.required,
      maxLength: field.maxLength,
    }));

export const webMockHomeGateway = {
  async listTaskTemplates(): Promise<TaskTemplate[]> {
    return clone(templates);
  },

  async listResults(workspaceId?: string): Promise<ResultSummary[]> {
    return clone(
      workspaceId ? results.filter((item) => item.workspaceId === workspaceId) : results
    );
  },

  async searchAuthorizedContent(
    input: SearchAuthorizedContentInput
  ): Promise<SearchAuthorizedContentOutput> {
    const query = input.query.trim().toLocaleLowerCase();
    if (!query || [...query].length > 200) {
      throw new Error('搜索内容不能为空且不能超过 200 个字符');
    }
    const limit = input.limit ?? 20;
    if (limit < 1 || limit > 50) throw new Error('搜索结果数量必须在 1 到 50 之间');
    const items = [...resultRecords.values()]
      .filter((record) =>
        `${record.detail.title}\n${record.content}`.toLocaleLowerCase().includes(query)
      )
      .sort((left, right) => right.detail.updatedAt.localeCompare(left.detail.updatedAt))
      .slice(0, limit)
      .map((record) => ({
        id: record.detail.id,
        kind: 'result' as const,
        title: record.detail.title,
        snippet: record.content.replace(/\s+/g, ' ').trim().slice(0, 220),
        updatedAt: record.detail.updatedAt,
        score: 1,
      }));
    return {
      query: input.query.trim(),
      items,
      indexedDocuments: resultRecords.size,
      skippedDocuments: 0,
      indexMode: 'memory_lexical',
    };
  },

  async rebuildAuthorizedSearchIndex() {
    return {
      clearedDocuments: resultRecords.size,
      resultDataChanged: false as const,
    };
  },

  async createTextResult(input: CreateTextResultInput): Promise<ResultDocument> {
    const title = input.title.trim();
    const fileName = input.fileName.trim();
    const type = input.type ?? 'document';
    const expectedFormats: Record<ResultType, TextResultFormat[]> = {
      document: ['markdown', 'plain_text'],
      spreadsheet: ['csv'],
      checklist: ['json'],
      form: ['json'],
      tool: ['json'],
    };
    if (!title || title.length > 160) throw new Error('成果标题不能为空且不能超过 160 个字符');
    if (
      !fileName ||
      fileName.includes('..') ||
      /[\\/:<>"|?*]/.test(fileName) ||
      !expectedFormats[type].includes(input.format) ||
      (input.format === 'markdown' && !/\.(md|markdown)$/i.test(fileName)) ||
      (input.format === 'plain_text' && !/\.txt$/i.test(fileName)) ||
      (input.format === 'csv' && !/\.csv$/i.test(fileName)) ||
      (input.format === 'json' && !/\.json$/i.test(fileName))
    ) {
      throw new Error('文件名或扩展名无效');
    }
    if ([...resultRecords.values()].some((record) => record.fileName === fileName)) {
      throw new Error('同名成果已存在，未覆盖任何文件');
    }
    const id = `web-mock-result-created-${++sequence}`;
    const revisionId = `web-mock-revision-${sequence}-initial`;
    const timestamp = `2026-08-17 11:${String(sequence).padStart(2, '0')}:00`;
    const content =
      input.format === 'markdown'
        ? `# ${title}\n\n`
        : input.format === 'plain_text'
          ? `${title}\n\n`
          : input.format === 'csv'
            ? 'Column 1,Column 2\n,\n'
            : type === 'checklist'
              ? JSON.stringify(
                  { items: [{ id: 'item-1', text: title, completed: false }] },
                  null,
                  2
                )
              : type === 'form'
                ? JSON.stringify(
                    {
                      fields: [{ id: 'field-1', label: title, kind: 'text', required: false }],
                    },
                    null,
                    2
                  )
                : JSON.stringify(
                    { settings: [{ key: 'title', label: 'Title', value: title }] },
                    null,
                    2
                  );
    const detail: ResultDetail = {
      id,
      workspaceId: 'web-mock-managed-results',
      type,
      title,
      status: 'draft',
      storageKind: 'managed_local',
      currentRevisionId: revisionId,
      a2uiSurfaceId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      storageRef: `result://file/${id}`,
      activeSessionId: null,
      managedState: { adapter: type, format: input.format },
    };
    const record: MockResultRecord = {
      detail,
      format: input.format,
      fileName,
      content,
      appliedReview: null,
      revisions: [
        {
          id: revisionId,
          contentHash: mockHash(content),
          source: 'initial',
          summary: '创建成果',
          createdAt: timestamp,
          isCurrent: true,
          content,
        },
      ],
    };
    resultRecords.set(id, record);
    results = [detail, ...results];
    return clone(documentFor(record));
  },

  async readResultDocument(resultId: string): Promise<ResultDocument> {
    return clone(documentFor(requireRecord(resultId)));
  },

  async saveResultDocument(
    resultId: string,
    content: string,
    baseHash: string
  ): Promise<ResultDocument> {
    const record = requireRecord(resultId);
    if (mockHash(record.content) !== baseHash) throw new Error('文件已在外部发生变化');
    if (content !== record.content) {
      record.content = content;
      const revisionId = `web-mock-revision-${++sequence}`;
      const timestamp = `2026-08-17 12:${String(sequence).padStart(2, '0')}:00`;
      record.revisions.forEach((revision) => (revision.isCurrent = false));
      record.revisions.unshift({
        id: revisionId,
        contentHash: mockHash(content),
        source: 'autosave',
        summary: '保存成果',
        createdAt: timestamp,
        isCurrent: true,
        content,
      });
      record.detail = { ...record.detail, currentRevisionId: revisionId, updatedAt: timestamp };
      results = results.map((item) => (item.id === resultId ? record.detail : item));
    }
    resultDrafts.delete(resultId);
    return clone(documentFor(record));
  },

  async saveResultDraft(
    resultId: string,
    content: string,
    baseHash: string
  ): Promise<ResultRecoveryDraft> {
    requireRecord(resultId);
    const draft: ResultRecoveryDraft = {
      content,
      contentHash: mockHash(content),
      baseHash,
      conflicted: mockHash(requireRecord(resultId).content) !== baseHash,
      updatedAt: new Date().toISOString(),
    };
    resultDrafts.set(resultId, draft);
    return clone(draft);
  },

  async discardResultDraft(resultId: string): Promise<boolean> {
    return resultDrafts.delete(resultId);
  },

  async getRecoveryStatus(): Promise<RecoveryStatus> {
    return {
      schemaVersion: 16,
      resultDrafts: [...resultDrafts.entries()].map(([resultId, draft]) => ({
        resultId,
        title: requireRecord(resultId).detail.title,
        updatedAt: draft.updatedAt,
      })),
      activeReviewCount: 0,
      recoveredTaskCount: 0,
      exportJobs: [],
    };
  },

  async listResultRevisions(resultId: string): Promise<ResultRevisionSummary[]> {
    return clone(
      requireRecord(resultId).revisions.map((revision) => ({
        id: revision.id,
        contentHash: revision.contentHash,
        source: revision.source,
        summary: revision.summary,
        createdAt: revision.createdAt,
        isCurrent: revision.isCurrent,
      }))
    );
  },

  async readResultRevision(resultId: string, revisionId: string): Promise<ResultRevision> {
    const revision = requireRecord(resultId).revisions.find((item) => item.id === revisionId);
    if (!revision) throw new Error('找不到指定成果版本');
    return clone(revision);
  },

  async restoreResultRevision(
    resultId: string,
    revisionId: string,
    baseHash: string
  ): Promise<ResultDocument> {
    const record = requireRecord(resultId);
    const revision = record.revisions.find((item) => item.id === revisionId);
    if (!revision) throw new Error('找不到指定成果版本');
    return this.saveResultDocument(resultId, revision.content, baseHash);
  },

  async duplicateResult(resultId: string): Promise<ResultDocument> {
    const source = requireRecord(resultId);
    const extension =
      source.format === 'markdown' ? 'md' : source.format === 'plain_text' ? 'txt' : source.format;
    const created = await this.createTextResult({
      title: `${source.detail.title} - 副本`,
      fileName: `副本-${++sequence}.${extension}`,
      type: source.detail.type,
      format: source.format,
    });
    const record = requireRecord(created.result.id);
    record.content = source.content;
    record.revisions[0].content = source.content;
    record.revisions[0].contentHash = mockHash(source.content);
    return clone(documentFor(record));
  },

  async exportResult(
    input: ExportResultInput,
    onProgress: (event: ExportProgressEvent) => void
  ): Promise<ExportResultOutput> {
    const record = requireRecord(input.resultId);
    if (record.detail.currentRevisionId !== input.revisionId)
      throw new Error('成果版本已变化，请重新导出');
    if (
      record.detail.a2uiSurfaceId ||
      !exportFormatsFor(record.detail.type, record.format).includes(input.format)
    )
      throw new Error('该成果类型不支持所选导出格式');
    if (activeExports.size) throw new Error('已有导出任务正在进行');
    const job = { cancelled: false, committing: false };
    activeExports.set(input.exportId, job);
    try {
      onProgress({ exportId: input.exportId, stage: 'preparing', progress: 10 });
      await exportTurn();
      if (!job.cancelled)
        onProgress({ exportId: input.exportId, stage: 'generating', progress: 50 });
      await exportTurn();
      if (job.cancelled) {
        onProgress({ exportId: input.exportId, stage: 'cancelled', progress: 100 });
        return { ...input, status: 'cancelled', fileName: null };
      }
      if (requireRecord(input.resultId).detail.currentRevisionId !== input.revisionId)
        throw new Error('成果版本已变化，请重新导出');
      job.committing = true;
      onProgress({ exportId: input.exportId, stage: 'writing', progress: 80 });
      onProgress({ exportId: input.exportId, stage: 'completed', progress: 100 });
      return { ...input, status: 'completed', fileName: `result.${exportExtension(input.format)}` };
    } finally {
      activeExports.delete(input.exportId);
    }
  },

  async cancelExport(exportId: string): Promise<boolean> {
    const job = activeExports.get(exportId);
    if (!job || job.committing) return false;
    job.cancelled = true;
    return true;
  },

  async createTask(workspaceId: string, templateId: string): Promise<TaskDetail> {
    const template = templates.find((item) => item.id === templateId);
    if (!template) throw new Error('模板不存在或不可用');
    const inputAnswers = Object.fromEntries(
      template.fields
        .filter((field) => field.defaultValue !== null)
        .map((field) => [field.id, field.defaultValue])
    );
    const questions = questionsFor(template, inputAnswers);
    const timestamp = '2026-08-17 10:00:00';
    const task: TaskDetail = {
      id: `web-mock-task-${++sequence}`,
      workspaceId,
      templateId,
      templateVersion: template.version,
      kind: template.kind,
      desiredResultType: 'document',
      status: questions.length ? 'awaiting_input' : 'ready',
      inputAnswers,
      questions,
      resultId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    tasks.set(task.id, task);
    return clone(task);
  },

  async answerTaskQuestions(taskId: string, answers: Record<string, unknown>): Promise<TaskDetail> {
    const task = tasks.get(taskId);
    if (!task) throw new Error('任务不存在');
    const template = templates.find((item) => item.id === task.templateId)!;
    const allowed = new Set(template.fields.map((field) => field.id));
    if (Object.keys(answers).some((key) => !allowed.has(key))) {
      throw new Error('回答包含模板未声明的字段');
    }
    const inputAnswers = { ...task.inputAnswers, ...answers };
    const questions = questionsFor(template, inputAnswers);
    const updated: TaskDetail = {
      ...task,
      inputAnswers,
      questions,
      status: questions.length ? 'awaiting_input' : 'ready',
      updatedAt: '2026-08-17 10:01:00',
    };
    tasks.set(taskId, updated);
    return clone(updated);
  },

  async startTask(taskId: string): Promise<TaskRunResult> {
    const task = tasks.get(taskId);
    if (!task || task.status !== 'ready') throw new Error('任务尚未就绪或已经执行');
    const template = templates.find((item) => item.id === task.templateId)!;
    const detailKey = ['meetingTitle', 'reportPeriod', 'targetRole'].find((key) =>
      String(task.inputAnswers[key] ?? '').trim()
    );
    const detail = detailKey ? String(task.inputAnswers[detailKey]).trim() : '';
    const title = detail ? `${template.name} - ${detail}` : template.name;
    const resultId = `web-mock-result-${sequence}`;
    const timestamp = '2026-08-17 10:02:00';
    const summary: ResultSummary = {
      id: resultId,
      workspaceId: task.workspaceId,
      type: 'document',
      title,
      status: 'draft',
      storageKind: 'managed_local',
      currentRevisionId: `web-mock-revision-${sequence}-initial`,
      a2uiSurfaceId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    const completedTask: TaskDetail = {
      ...task,
      status: 'completed',
      questions: [],
      resultId,
      updatedAt: timestamp,
      completedAt: timestamp,
    };
    tasks.set(taskId, completedTask);
    results = [summary, ...results];
    const content = `# ${title}\n\n> 本文件是本地结构草稿；尚未调用 AI 生成正文。\n`;
    resultRecords.set(resultId, {
      detail: {
        ...summary,
        storageRef: `result://file/${resultId}`,
        activeSessionId: null,
        managedState: {
          format: 'markdown',
          localScaffold: true,
          templateId: template.id,
          templateVersion: template.version,
        },
      },
      format: 'markdown',
      fileName: `${resultId}.md`,
      content,
      appliedReview: null,
      revisions: [
        {
          id: summary.currentRevisionId!,
          contentHash: mockHash(content),
          source: 'initial',
          summary: '创建本地任务草稿',
          createdAt: timestamp,
          isCurrent: true,
          content,
        },
      ],
    });
    return {
      task: clone(completedTask),
      result: {
        ...clone(summary),
        storageRef: `result://file/${resultId}`,
        activeSessionId: null,
        managedState: {
          format: 'markdown',
          localScaffold: true,
          templateId: template.id,
          templateVersion: template.version,
        },
      },
      outputMode: 'local_scaffold',
    };
  },
};

export function resetWebMockHomeGateway(): void {
  for (const job of activeExports.values()) job.cancelled = true;
  results = [...initialResults];
  tasks = new Map();
  sequence = 0;
  resultRecords = initialRecords();
  resultDrafts.clear();
}

export async function createWebMockReviewResult(input: {
  title: string;
  fileName: string;
  format: 'markdown' | 'plain_text';
  content: string;
  reviewId: string;
  workspaceId: string;
}): Promise<ResultDocument> {
  const created = await webMockHomeGateway.createTextResult(input);
  const record = requireRecord(created.result.id);
  record.content = input.content;
  record.revisions[0].content = input.content;
  record.revisions[0].contentHash = mockHash(input.content);
  record.appliedReview = { reviewId: input.reviewId, workspaceId: input.workspaceId };
  return clone(documentFor(record));
}

export function deleteWebMockReviewResult(resultId: string): void {
  resultRecords.delete(resultId);
  results = results.filter((result) => result.id !== resultId);
}

export function deleteWebMockReviewResultByReview(reviewId: string, workspaceId: string): void {
  const result = [...resultRecords.entries()].find(
    ([, record]) =>
      record.appliedReview?.reviewId === reviewId &&
      record.appliedReview.workspaceId === workspaceId
  );
  if (result) deleteWebMockReviewResult(result[0]);
}
