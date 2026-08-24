import type {
  A2uiInspection,
  A2uiSurface,
  ChatSession,
  ReviewRequest,
  WorkspaceFile,
} from '../types/domain';

export const mockFiles: WorkspaceFile[] = [
  {
    path: 'README.md',
    name: 'README.md',
    language: 'markdown',
    content:
      '# A2UI Research Notes\n\nA local-first workspace for reviewable AI changes.\n\n## Goals\n\n- Explicit context\n- Safe patches\n- Version history\n',
  },
  {
    path: 'src/experiment.ts',
    name: 'experiment.ts',
    language: 'typescript',
    content:
      "export const experiment = {\n  name: 'context-window',\n  samples: 128,\n  status: 'draft',\n};\n",
  },
  {
    path: 'data/config.yaml',
    name: 'config.yaml',
    language: 'yaml',
    content: 'model: deepseek-chat\ntemperature: 0.2\nstream: true\n',
  },
  {
    path: 'scripts/analyze.py',
    name: 'analyze.py',
    language: 'python',
    content: 'def summarize(rows):\n    return {"count": len(rows)}\n',
  },
];

export const mockSessions: ChatSession[] = [
  {
    id: 'welcome',
    title: 'README 优化',
    messages: [
      {
        id: 'welcome-message',
        role: 'assistant',
        content: '选择上下文后告诉我需要修改什么。我会先生成可审阅的 Patch。',
        status: 'complete',
      },
    ],
  },
];

export const createMockDiff = (file: WorkspaceFile): ReviewRequest => {
  const id = crypto.randomUUID();
  const anchor = file.content;
  const content = `${file.content.trim()}\n\n## Review workflow\n\nEvery AI change must be reviewed before it is applied.\n`;
  return {
    id,
    workspaceId: 'web-mock-workspace',
    resultId: null,
    source: 'chat',
    operationKind: 'document_patch',
    status: 'pending',
    summary: 'Clarify the document goal and add a review requirement.',
    risk: 'medium',
    baseRevisionId: null,
    baseHash: file.contentHash ?? 'web-mock-revision',
    blocks: [
      {
        id,
        kind: 'document_patch',
        status: 'pending',
        targetLabel: file.path,
        operation: 'replace',
        reason: 'Clarify the document goal and add a review requirement.',
        risk: 'medium',
        before: anchor,
        after: content,
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
};

export const createMockCreateFileReview = (): ReviewRequest => {
  const id = crypto.randomUUID();
  return {
    id,
    workspaceId: 'web-mock-workspace',
    resultId: null,
    source: 'chat',
    operationKind: 'create_file',
    status: 'pending',
    summary: '生成一份杭州三日游计划',
    risk: 'medium',
    baseRevisionId: null,
    baseHash: null,
    blocks: [
      {
        id: crypto.randomUUID(),
        kind: 'create_file',
        status: 'pending',
        targetLabel: '我的成果（应用管理目录）',
        operation: 'create',
        reason: '用户要求生成完整出游文档',
        risk: 'medium',
        before: '',
        after: '# 杭州三日游\n\n## 第一天\n\n抵达杭州并游览西湖。\n',
        suggestedFileName: '杭州三日游.md',
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
};

export const createMockA2ui = (): { surface: A2uiSurface; inspection: A2uiInspection } => {
  const rawMessage = JSON.stringify({
    version: '1.0',
    type: 'a2ui_surface',
    surfaceId: 'web-mock-form',
    revision: 1,
  });
  const validation = { valid: true, errors: [], warnings: [], durationMs: 1 };
  const surface: A2uiSurface = {
    surfaceId: 'web-mock-form',
    workspaceId: 'web-mock-workspace',
    sessionId: 'welcome',
    messageId: 'web-mock-a2ui',
    revision: 1,
    rawMessage,
    validation,
    events: [],
    data: { name: '', role: 'researcher', updates: true },
    root: {
      id: 'root',
      component: 'Column',
      props: { gap: 'md' },
      actions: {},
      children: [
        {
          id: 'title',
          component: 'Text',
          props: { text: 'Research profile', variant: 'title' },
          actions: {},
          children: [],
        },
        {
          id: 'name',
          component: 'TextField',
          props: { name: 'name', label: 'Name', placeholder: 'Ada' },
          actions: { change: { type: 'set_state', target: 'name' } },
          children: [],
        },
        {
          id: 'role',
          component: 'Select',
          props: {
            name: 'role',
            label: 'Role',
            options: [
              { label: 'Researcher', value: 'researcher' },
              { label: 'Developer', value: 'developer' },
            ],
          },
          actions: { change: { type: 'set_state', target: 'role' } },
          children: [],
        },
        {
          id: 'updates',
          component: 'Checkbox',
          props: { name: 'updates', label: 'Receive updates' },
          actions: { change: { type: 'set_state', target: 'updates' } },
          children: [],
        },
        {
          id: 'submit',
          component: 'Button',
          props: { label: 'Submit', variant: 'primary' },
          actions: { click: { type: 'submit_form' } },
          children: [],
        },
      ],
    },
  };
  return {
    surface,
    inspection: {
      id: 'web-mock-inspection',
      messageId: surface.messageId,
      surfaceId: surface.surfaceId,
      rawMessage,
      validation,
      createdAt: null,
    },
  };
};
