import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import type { WritingPlan, WritingProject } from '../../shared/types/writingProject';
import { WritingSendSummary } from './WritingSendSummary';

const project: WritingProject = {
  id: 'project',
  workspaceId: 'workspace',
  revision: 3,
  config: {
    title: '报告',
    goal: '写报告',
    audience: '读者',
    facts: '',
    terminology: '',
    knowledgeIds: [],
    documentSourceIds: [],
    contextPackIds: [],
  },
  outlineConfirmed: true,
  finalReviewId: null,
  resultId: null,
  sections: [
    {
      id: 'one',
      title: '前章',
      objective: '',
      targetWords: 300,
      content: '已接受正文',
      summary: '前章摘要',
      accepted: true,
      runId: null,
      requestId: null,
    },
    {
      id: 'two',
      title: '本章',
      objective: '',
      targetWords: 300,
      content: '本章正文',
      summary: '',
      accepted: true,
      runId: null,
      requestId: null,
    },
  ],
};
const plan = {
  id: 'plan',
  requestId: 'request',
  prompt: '长文目标与本章正文',
  manifest: {
    processingLocation: 'cloud',
    writingProfile: {
      enabled: false,
      layers: [],
      composerVersion: 'm2.1',
      hash: 'snapshot',
      estimatedTokens: 0,
    },
    includedSources: [
      { kind: 'personal_knowledge', label: 'paper.pdf', mode: 'full', characterCount: 400 },
    ],
    excludedSources: [],
  },
} as unknown as WritingPlan;

describe('WritingSendSummary', () => {
  it('shows actual project and chapter scope without technical details in simple mode', () => {
    render(
      <I18nProvider>
        <WritingSendSummary
          plan={plan}
          project={project}
          section={project.sections[1]}
          professional={false}
        />
      </I18nProvider>
    );
    expect(screen.getByText(/项目目标、读者、关键事实、术语与大纲/)).toBeInTheDocument();
    expect(screen.getByText(/前文摘要（1 节）/)).toBeInTheDocument();
    expect(screen.getByText('本章已接受的正文')).toBeInTheDocument();
    expect(screen.getByText(/paper.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/云端模型/)).toBeInTheDocument();
    expect(screen.queryByText('查看技术清单与本次指令')).not.toBeInTheDocument();
  });

  it('keeps the detailed manifest available only in professional mode', () => {
    const emptyPlan = { ...plan, manifest: { ...plan.manifest, includedSources: [] } };
    render(
      <I18nProvider>
        <WritingSendSummary
          plan={emptyPlan}
          project={project}
          section={project.sections[1]}
          professional
        />
      </I18nProvider>
    );
    expect(screen.getByText('查看技术清单与本次指令')).toBeInTheDocument();
    expect(screen.getByText('本章已接受的正文')).toBeInTheDocument();
    expect(
      screen.getByText('未选择额外资料；项目指令可能包含已接受的本章正文')
    ).toBeInTheDocument();
    expect(screen.queryByText('不发送文件内容')).not.toBeInTheDocument();
  });
});
