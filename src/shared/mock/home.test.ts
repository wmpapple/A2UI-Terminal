import { beforeEach, describe, expect, it } from 'vitest';
import { resetWebMockHomeGateway, webMockHomeGateway } from './home';

describe('Web Mock home gateway', () => {
  beforeEach(() => resetWebMockHomeGateway());

  it('keeps pin metadata across reads and saves and restores recency order when unpinned', async () => {
    const [older] = await webMockHomeGateway.listResults();
    const recent = await webMockHomeGateway.createTextResult({
      title: 'Recent result',
      fileName: 'recent.md',
      format: 'markdown',
    });
    const original = await webMockHomeGateway.readResultDocument(older.id);
    await webMockHomeGateway.pinResult(older.id, true);
    expect((await webMockHomeGateway.listResults()).map((item) => item.id)).toEqual([
      older.id,
      recent.result.id,
    ]);
    expect(await webMockHomeGateway.readResultDocument(older.id)).toEqual({
      ...original,
      result: { ...original.result, pinned: true },
    });
    await webMockHomeGateway.pinResult(older.id, false);
    expect((await webMockHomeGateway.listResults()).map((item) => item.id)).toEqual([
      recent.result.id,
      older.id,
    ]);
    await webMockHomeGateway.pinResult(older.id, true);
    const saved = await webMockHomeGateway.saveResultDocument(
      older.id,
      'Edited content',
      original.contentHash
    );
    expect(saved.result.pinned).toBe(true);
    await expect(webMockHomeGateway.pinResult('missing', true)).rejects.toThrow();
    resetWebMockHomeGateway();
    expect((await webMockHomeGateway.listResults())[0].pinned).toBeFalsy();
  });

  it('cancels an in-flight export, preserves history and allows a fresh retry', async () => {
    const created = await webMockHomeGateway.createTextResult({
      title: 'test',
      fileName: 'test.md',
      format: 'markdown',
    });
    const input = {
      exportId: crypto.randomUUID(),
      resultId: created.result.id,
      revisionId: created.result.currentRevisionId!,
      format: 'pdf' as const,
    };
    const before = await webMockHomeGateway.listResultRevisions(created.result.id);
    const pending = webMockHomeGateway.exportResult(input, () => undefined);
    await expect(
      webMockHomeGateway.exportResult({ ...input, exportId: crypto.randomUUID() }, () => undefined)
    ).rejects.toThrow('已有导出任务');
    expect(await webMockHomeGateway.cancelExport(input.exportId)).toBe(true);
    expect(await pending).toMatchObject({ status: 'cancelled', fileName: null });
    expect(await webMockHomeGateway.cancelExport(input.exportId)).toBe(false);
    expect(await webMockHomeGateway.listResultRevisions(created.result.id)).toEqual(before);
    expect(
      await webMockHomeGateway.exportResult(
        { ...input, exportId: crypto.randomUUID() },
        () => undefined
      )
    ).toMatchObject({ status: 'completed' });
  });

  it('rejects mismatched formats and changes made during export without altering the Result', async () => {
    const created = await webMockHomeGateway.createTextResult({
      title: 'test',
      fileName: 'test.md',
      format: 'markdown',
    });
    const input = {
      exportId: crypto.randomUUID(),
      resultId: created.result.id,
      revisionId: created.result.currentRevisionId!,
      format: 'pdf' as const,
    };
    await expect(
      webMockHomeGateway.exportResult({ ...input, format: 'xlsx' }, () => undefined)
    ).rejects.toThrow('不支持');
    const pending = webMockHomeGateway.exportResult(input, () => undefined);
    const changed = await webMockHomeGateway.saveResultDocument(
      created.result.id,
      'changed',
      created.contentHash
    );
    await expect(pending).rejects.toThrow('成果版本已变化');
    expect(await webMockHomeGateway.readResultDocument(created.result.id)).toEqual(changed);
  });

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

  it('exports only the bound current revision and exposes no destination path', async () => {
    const created = await webMockHomeGateway.createTextResult({
      title: '导出验收',
      fileName: '导出验收.md',
      format: 'markdown',
    });
    const events: string[] = [];
    const output = await webMockHomeGateway.exportResult(
      {
        exportId: '00000000-0000-4000-8000-000000000001',
        resultId: created.result.id,
        revisionId: created.result.currentRevisionId!,
        format: 'pdf',
      },
      (event) => events.push(event.stage)
    );
    expect(events).toEqual(['preparing', 'generating', 'writing', 'completed']);
    expect(output).toMatchObject({ status: 'completed', fileName: 'result.pdf' });
    expect(output).not.toHaveProperty('path');
    await expect(
      webMockHomeGateway.exportResult(
        {
          exportId: output.exportId,
          resultId: output.resultId,
          revisionId: 'stale',
          format: output.format,
        },
        () => undefined
      )
    ).rejects.toThrow('成果版本已变化');
  });
});
