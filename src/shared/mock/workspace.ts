import type { ChatSession, DiffProposal, WorkspaceFile } from '../types/domain';

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

export const createMockDiff = (file: WorkspaceFile): DiffProposal => ({
  id: crypto.randomUUID(),
  path: file.path,
  reason: 'Clarify the document goal and add a review requirement.',
  risk: 'medium',
  before: file.content,
  after: `${file.content.trim()}\n\n## Review workflow\n\nEvery AI change must be reviewed before it is applied.\n`,
  accepted: true,
});
