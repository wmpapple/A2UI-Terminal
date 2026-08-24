import type {
  CreateTextResultInput,
  ResultDetail,
  ResultDocument,
  ResultRevision,
  ResultRevisionSummary,
  ResultSummary,
  TaskDetail,
  TaskQuestion,
  TaskRunResult,
  TaskTemplate,
} from '../types/domain';

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
  format: 'markdown' | 'plain_text';
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

const clone = <T>(value: T): T => structuredClone(value);

const documentFor = (record: MockResultRecord): ResultDocument => ({
  result: clone(record.detail),
  format: record.format,
  content: record.content,
  contentHash: mockHash(record.content),
  sizeBytes: new TextEncoder().encode(record.content).length,
  editable: true,
  appliedReview: clone(record.appliedReview),
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

  async createTextResult(input: CreateTextResultInput): Promise<ResultDocument> {
    const title = input.title.trim();
    const fileName = input.fileName.trim();
    if (!title || title.length > 160) throw new Error('成果标题不能为空且不能超过 160 个字符');
    if (
      !fileName ||
      fileName.includes('..') ||
      /[\\/:<>"|?*]/.test(fileName) ||
      (input.format === 'markdown'
        ? !/\.(md|markdown)$/i.test(fileName)
        : !/\.txt$/i.test(fileName))
    ) {
      throw new Error('文件名或扩展名无效');
    }
    if ([...resultRecords.values()].some((record) => record.fileName === fileName)) {
      throw new Error('同名成果已存在，未覆盖任何文件');
    }
    const id = `web-mock-result-created-${++sequence}`;
    const revisionId = `web-mock-revision-${sequence}-initial`;
    const timestamp = `2026-08-17 11:${String(sequence).padStart(2, '0')}:00`;
    const content = input.format === 'markdown' ? `# ${title}\n\n` : `${title}\n\n`;
    const detail: ResultDetail = {
      id,
      workspaceId: 'web-mock-managed-results',
      type: 'document',
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
      managedState: { format: input.format },
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
    return clone(documentFor(record));
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
    const extension = source.format === 'markdown' ? 'md' : 'txt';
    const created = await this.createTextResult({
      title: `${source.detail.title} - 副本`,
      fileName: `副本-${++sequence}.${extension}`,
      format: source.format,
    });
    const record = requireRecord(created.result.id);
    record.content = source.content;
    record.revisions[0].content = source.content;
    record.revisions[0].contentHash = mockHash(source.content);
    return clone(documentFor(record));
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
  results = [...initialResults];
  tasks = new Map();
  sequence = 0;
  resultRecords = initialRecords();
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
