import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function verifyCritic(page, received) {
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
  await create.getByLabel('成果标题').fill('M7 桌面审稿');
  await create.getByLabel('本地文件名').fill('m7-critic.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await page.getByText('编辑', { exact: true }).click();
  const editor = page.getByRole('textbox', { name: '成果编辑器' });
  const text = '# M7 桌面审稿\n\n### 赋能：层级待核对\n\n预算 420 元，尚未批准。\n\n团队。';
  await editor.fill(text);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const results = await invoke('list_results');
  const result = results.find((r) => r.title === 'M7 桌面审稿');
  assert(result);
  const input = {
    target: { kind: 'result', resultId: result.id },
    options: { sentenceLimit: 120, paragraphLimit: 400 },
  };
  const baseline = await invoke('read_result_document', { resultId: result.id });
  const before = received.length;
  await page.getByRole('button', { name: '文档审稿', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '文档审稿', exact: true });
  await expect(drawer.getByText('标题层级', { exact: true })).toBeVisible();
  await expect(drawer.getByText('禁用词', { exact: true })).toBeVisible();
  assert.equal(received.length, before);
  const local = await invoke('inspect_document_critic', { input });
  const forbidden = drawer.getByRole('article').filter({ hasText: '禁用词' });
  await forbidden.getByRole('button', { name: /忽\s*略/ }).click();
  await expect(forbidden).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '成果', exact: true })
    .click();
  await page
    .getByRole('article')
    .filter({ hasText: 'M7 桌面审稿' })
    .getByRole('button', { name: /继续处理/ })
    .click();
  await page.getByRole('button', { name: '文档审稿', exact: true }).click();
  await drawer.getByRole('checkbox', { name: '显示已忽略提示' }).check();
  await expect(forbidden.getByRole('button', { name: '让 AI 修改' })).toBeDisabled();
  await forbidden.getByRole('button', { name: '恢复提示' }).click();
  await drawer.getByRole('button', { name: 'AI 深度审稿' }).click();
  const confirmation = page.getByRole('dialog', { name: '确认本次审稿发送范围' });
  await expect(confirmation).toContainText('待审稿正文');
  assert.equal(received.length, before);
  await confirmation.getByRole('button', { name: '确认并开始' }).click();
  const ai = drawer.getByRole('region', { name: 'AI 审稿提示' });
  await expect(ai).toContainText('可调整句式，但保留预算及否定关系');
  assert.equal(
    (await invoke('read_result_document', { resultId: result.id })).contentHash,
    baseline.contentHash
  );
  await ai.getByRole('button', { name: '查看原文' }).click();
  const passage = page.getByRole('dialog', { name: '原文位置' });
  await expect(passage).toContainText('预算 420 元，尚未批准。');
  await passage.getByRole('button', { name: 'Close' }).click();
  await ai.getByRole('button', { name: '让 AI 修改' }).click();
  await expect(confirmation).toBeVisible();
  assert.equal(received.length, before + 1);
  await confirmation.getByRole('button', { name: '确认并开始' }).click();
  const proposal = page.getByRole('dialog', { name: '审阅修改提案' });
  await expect(proposal).toContainText('当前预算为 420 元，仍未获得批准。');
  assert.equal(
    (await invoke('read_result_document', { resultId: result.id })).contentHash,
    baseline.contentHash
  );
  await proposal.getByRole('button', { name: '接受并写入' }).click();
  await expect(proposal).toBeHidden();
  const updated = await invoke('read_result_document', { resultId: result.id });
  assert.equal(
    updated.content,
    text.replace('预算 420 元，尚未批准。', '当前预算为 420 元，仍未获得批准。')
  );
  await expect(ai).toHaveCount(0);
  await assert.rejects(() =>
    invoke('resolve_critic_finding', {
      reportId: local.local.id,
      findingId: local.local.findings[0].id,
    })
  );
  await drawer.getByRole('button', { name: 'Close' }).click();
  const history = await invoke('list_result_revisions', { resultId: result.id });
  await expect(drawer).toBeHidden();
  assert(history.length >= 3);
  assert.equal(received.length, before + 2);
  assert(received.every((r) => !r.credentialSent));
  return [
    'critic_local_zero_requests',
    'critic_ignored_restart',
    'critic_explicit_consent',
    'critic_read_only',
    'critic_located_passage',
    'critic_inline_review_apply',
    'critic_old_revision_rejected',
    'critic_saved_history',
  ];
}
