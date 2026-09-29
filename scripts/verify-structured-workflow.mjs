import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function verifyStructured(page, received) {
  const invoke = (command, args) =>
    page.evaluate(
      ([name, input]) => window.__TAURI_INTERNALS__.invoke(name, input),
      [command, args]
    );
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  await page.getByRole('button', { name: '新建成果' }).click();
  const create = page.getByRole('dialog', { name: '新建成果' });
  await create.getByLabel('成果标题').fill('M8 结构化报告');
  await create.getByLabel('本地文件名').fill('m8-report.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await page.getByText('编辑', { exact: true }).click();
  const text =
    '# M8 报告\n\n预算 **420** 元，尚未批准。\n\n| 名称 | 金额 |\n| --- | --- |\n| 项目 A | 420 |';
  await page.getByRole('textbox', { name: '成果编辑器' }).fill(text);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const result = (await invoke('list_results')).find((r) => r.title === 'M8 结构化报告');
  assert(result);
  const target = { kind: 'result', resultId: result.id };
  const sourceEditor = page.getByRole('textbox', { name: '成果编辑器' });
  await sourceEditor.evaluate((element) => {
    element.focus();
    const start = element.value.indexOf('尚未批准');
    element.setSelectionRange(start, start + 4);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: /加\s*粗/, exact: true }).click();
  const manuallyFormatted = text.replace('尚未批准', '**尚未批准**');
  await expect(sourceEditor).toHaveValue(manuallyFormatted);
  await expect
    .poll(async () => (await invoke('read_result_document', { resultId: result.id })).content)
    .toBe(manuallyFormatted);
  await page.reload();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '成果', exact: true })
    .click();
  await page
    .getByRole('article')
    .filter({ hasText: 'M8 结构化报告' })
    .getByRole('button', { name: /继续处理/ })
    .click();
  await page.getByText('编辑', { exact: true }).click();
  await expect(sourceEditor).toHaveValue(manuallyFormatted);
  await sourceEditor.fill(text);
  await expect
    .poll(async () => (await invoke('read_result_document', { resultId: result.id })).content)
    .toBe(text);
  const before = received.length;
  await page.getByRole('button', { name: '结构化编辑', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '结构化文档', exact: true });
  await expect(drawer.getByLabel('单元格 2,2')).toBeVisible();
  const baseline = await invoke('inspect_structured_document', { target });
  assert.equal(baseline.document.blocks.length, 3);
  await drawer.getByLabel('单元格 2,2').fill('420（待批准）');
  await drawer.getByLabel('单元格 2,2').blur();
  const review = page.getByRole('dialog', { name: '确认文档修改' });
  await expect(review).toContainText('420（待批准）');
  assert.equal((await invoke('read_result_document', { resultId: result.id })).content, text);
  await review.getByRole('button', { name: '接受并保存' }).click();
  await expect(review).toBeHidden();
  await expect(drawer.getByLabel('单元格 2,2')).toHaveValue('420（待批准）');
  let changed = await invoke('inspect_structured_document', { target });
  assert.deepEqual(
    changed.document.blocks.map((b) => b.id),
    baseline.document.blocks.map((b) => b.id)
  );
  assert(changed.snapshot.text.includes('**420**'));
  const paragraph = drawer.locator(`[data-block-id="${baseline.document.blocks[1].id}"]`);
  await paragraph.getByRole('button', { name: /编\s*辑/ }).click();
  const rich = paragraph.getByRole('textbox', { name: '段落内容' });
  await rich.fill('M8 预算 420 元，尚未批准。');
  await rich.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await paragraph.getByRole('button', { name: /加\s*粗/ }).click();
  await paragraph.getByRole('button', { name: '审阅本段修改' }).click();
  await expect(review).toContainText('尚未批准');
  await review.getByRole('button', { name: '接受并保存' }).click();
  await expect(review).toBeHidden();
  const formatted = await invoke('inspect_structured_document', { target });
  assert.equal(formatted.document.blocks[1].id, baseline.document.blocks[1].id);
  const runs = formatted.document.blocks[1].node.runs;
  assert.equal(runs.map((run) => run.text).join(''), 'M8 预算 420 元，尚未批准。');
  assert(runs.filter((run) => run.text.trim()).every((run) => run.bold));
  await drawer.getByRole('button', { name: '插入分页' }).click();
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: '放弃修改' }).click();
  await expect(review).toBeHidden();
  changed = await invoke('inspect_structured_document', { target });
  assert.equal(changed.document.blocks.length, 3);
  await drawer.getByRole('button', { name: '添加段落 / 列表' }).click();
  await drawer.getByLabel('新段落内容').fill('总结：保持事实和审批状态。');
  await drawer.getByRole('button', { name: '预览插入' }).click();
  await review.getByRole('button', { name: '接受并保存' }).click();
  await expect(review).toBeHidden();
  const saved = await invoke('inspect_structured_document', { target });
  assert.equal(saved.document.blocks.length, 4);
  const edit = saved.document.blocks[1];
  const pending = await invoke('propose_structured_patch', {
    patch: {
      schemaVersion: 2,
      target,
      baseHash: saved.snapshot.contentHash,
      baseRevisionId: saved.snapshot.revisionId,
      operations: [{ op: 'replace_text', blockId: edit.id, text: '过期候选' }],
    },
  });
  await invoke('save_result_document', {
    input: {
      resultId: result.id,
      baseHash: saved.snapshot.contentHash,
      content: saved.snapshot.text + '\n\n外部变化',
    },
  });
  await invoke('decide_review_blocks', {
    input: {
      reviewId: pending.id,
      workspaceId: pending.workspaceId,
      decisions: pending.blocks.map((b) => ({ blockId: b.id, accepted: true })),
    },
  });
  await assert.rejects(() =>
    invoke('apply_review', { input: { reviewId: pending.id, workspaceId: pending.workspaceId } })
  );
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  const reopened = await invoke('inspect_structured_document', { target });
  assert.deepEqual(
    reopened.document.blocks.slice(0, 4).map((b) => b.id),
    saved.document.blocks.map((b) => b.id)
  );
  assert.equal(received.length, before);
  return [
    'structured_table_review_before_write',
    'structured_stable_ids',
    'structured_discard',
    'structured_insert',
    'structured_stale_candidate_blocked',
    'structured_webview_reload',
    'structured_zero_model_requests',
    'structured_rich_text_formatting',
  ];
}
