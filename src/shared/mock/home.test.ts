import { beforeEach, describe, expect, it } from 'vitest';
import { resetWebMockHomeGateway, webMockHomeGateway } from './home';

describe('Web Mock home gateway', () => {
  beforeEach(() => resetWebMockHomeGateway());

  it('lists versioned templates and recent results independently of chats', async () => {
    const templates = await webMockHomeGateway.listTaskTemplates();
    const results = await webMockHomeGateway.listResults();

    expect(templates.map((item) => item.id)).toEqual([
      'meeting_minutes',
      'document_summary',
      'weekly_report',
      'resume_optimization',
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('A2UI 调研纪要');
  });

  it('completes the local Task to Result scaffold without claiming AI generation', async () => {
    const task = await webMockHomeGateway.createTask('web-mock-workspace', 'meeting_minutes');
    expect(task.status).toBe('awaiting_input');

    const ready = await webMockHomeGateway.answerTaskQuestions(task.id, {
      meetingTitle: '产品例会',
    });
    expect(ready.status).toBe('ready');

    const run = await webMockHomeGateway.startTask(task.id);
    expect(run.outputMode).toBe('local_scaffold');
    expect(run.result.title).toBe('会议纪要 - 产品例会');
    expect(run.result.managedState).toMatchObject({ localScaffold: true });
    expect((await webMockHomeGateway.listResults())[0].id).toBe(run.result.id);
  });

  it('mirrors the managed text Result create, save, history, restore, and copy contract', async () => {
    const created = await webMockHomeGateway.createTextResult({
      title: '验收记录',
      fileName: '验收记录.md',
      format: 'markdown',
    });
    const saved = await webMockHomeGateway.saveResultDocument(
      created.result.id,
      '# 验收记录\n\n第二版',
      created.contentHash
    );
    const revisions = await webMockHomeGateway.listResultRevisions(created.result.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[0].isCurrent).toBe(true);
    const restored = await webMockHomeGateway.restoreResultRevision(
      created.result.id,
      revisions[1].id,
      saved.contentHash
    );
    expect(restored.content).toBe(created.content);
    const copy = await webMockHomeGateway.duplicateResult(created.result.id);
    expect(copy.result.id).not.toBe(created.result.id);
    expect(copy.content).toBe(created.content);
  });
});
