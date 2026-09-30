import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import { expect } from '@playwright/test';
const exec = promisify(execFile);

export async function verifyCollaboration(page, received, output, processId) {
  const invoke = (command, args) =>
    page.evaluate(
      ([name, input]) => window.__TAURI_INTERNALS__.invoke(name, input),
      [command, args]
    );
  const pick = (selected) =>
    exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve('scripts/select-collaboration-file.ps1'),
        '-ApplicationProcessId',
        String(processId),
        '-SelectedPath',
        selected,
      ],
      { windowsHide: true, timeout: 30000 }
    );
  const shareFile = path.join(output, 'roundtrip-share.a2uishare');
  const feedbackFile = path.join(output, 'roundtrip-feedback.a2uishare');
  // Remove only this run's known generated fixtures, so no overwrite dialog masks a test.
  await fs.rm(shareFile, { force: true });
  await fs.rm(feedbackFile, { force: true });
  const before = received.length;
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  await page.getByRole('button', { name: '新建成果' }).click();
  const create = page.getByRole('dialog', { name: '新建成果' });
  await create.getByLabel('成果标题').fill('M10 本地协作');
  await create.getByLabel('本地文件名').fill('m10-report.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await page.getByText('编辑', { exact: true }).click();
  const original = '# 项目预算\n\n预算 420 元，尚未批准。🙂';
  const revised = '# 项目预算\n\n当前预算为 420 元，仍未批准。🙂';
  await page.getByRole('textbox', { name: '成果编辑器' }).fill(original);
  const result = (await invoke('list_results')).find((r) => r.title === 'M10 本地协作');
  await expect
    .poll(async () => (await invoke('read_result_document', { resultId: result.id })).content)
    .toBe(original);
  await page.getByRole('button', { name: '协作审阅', exact: true }).click();
  let panel = page.getByRole('dialog', { name: '本地协作', exact: true });
  await expect(panel.getByLabel('我的协作署名')).toBeVisible();
  await panel.getByLabel('我的协作署名').fill('本地作者');
  await panel.getByRole('button', { name: '保存署名' }).click();
  await expect(panel.getByRole('button', { name: '创建并导出分享包' })).toBeEnabled();
  await Promise.all([
    pick(shareFile),
    panel.getByRole('button', { name: '创建并导出分享包' }).click(),
  ]);
  await expect(panel.getByText('分享包已导出，请交给审阅者。')).toBeVisible();
  const exported = JSON.parse(await fs.readFile(shareFile, 'utf8'));
  assert.equal(exported.kind, 'share');
  assert.equal(exported.payload.content, original);
  assert(!JSON.stringify(exported).includes(result.id));
  await Promise.all([pick(shareFile), panel.getByRole('button', { name: '导入协作包' }).click()]);
  await expect(panel.getByLabel('审阅意见')).toBeEnabled();
  await panel.getByLabel('审阅意见').fill('保留预算数字和未批准状态，调整措辞。');
  await panel.getByLabel('附上建议修改稿（全文）').check();
  await panel.getByRole('textbox', { name: '建议修改稿' }).fill(revised);
  assert.equal((await invoke('read_result_document', { resultId: result.id })).content, original);
  await Promise.all([
    pick(feedbackFile),
    panel.getByRole('button', { name: '保存并导出意见包' }).click(),
  ]);
  await expect(panel.getByText('意见包已导出，请交回成果所有者。')).toBeVisible();
  await Promise.all([
    pick(feedbackFile),
    panel.getByRole('button', { name: '导入协作包' }).click(),
  ]);
  await expect(panel.getByRole('button', { name: '审阅建议修改' })).toBeEnabled();
  await panel.getByRole('button', { name: '审阅建议修改' }).click();
  const review = page.getByRole('dialog', { name: '确认协作修改', exact: true });
  await expect(review).toContainText(original);
  await expect(review).toContainText(revised);
  assert.equal((await invoke('read_result_document', { resultId: result.id })).content, original);
  await review.getByRole('button', { name: '接受并修改正文' }).click();
  await expect
    .poll(async () => (await invoke('read_result_document', { resultId: result.id })).content)
    .toBe(revised);
  await panel.getByRole('button', { name: '撤销刚才的协作修改' }).click();
  await expect
    .poll(async () => (await invoke('read_result_document', { resultId: result.id })).content)
    .toBe(original);
  await page.screenshot({ path: path.join(output, 'collaboration-roundtrip.png') });
  await panel.getByRole('button', { name: '审阅建议修改' }).click();
  await expect(panel.getByText(/旧建议不能通过重试应用/)).toBeVisible();
  await page.reload();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '成果', exact: true })
    .click();
  await page.getByRole('button', { name: '协作收件箱' }).click();
  panel = page.getByRole('dialog', { name: '本地协作', exact: true });
  await expect(panel.getByLabel('我的协作署名')).toHaveValue('本地作者');
  await expect(panel.getByText('本地作者 · 审阅意见', { exact: false })).toBeVisible();
  const overview = await invoke('collaboration_overview', { resultId: result.id });
  assert.equal(overview.inbox.length, 2);
  assert.equal(overview.shares.length, 1);
  await panel.getByRole('button', { name: '撤销分享', exact: true }).click();
  await page
    .getByRole('dialog', { name: '撤销此分享？' })
    .getByRole('button', { name: '撤销分享', exact: true })
    .click();
  await expect(panel.getByText('已撤销', { exact: true })).toBeVisible();
  await assert.rejects(
    invoke('collaboration_propose', { id: overview.inbox.find((x) => x.kind === 'feedback').id })
  );
  assert.equal(received.length, before, 'local collaboration must not call any model');
  return [
    'collaboration_native_export',
    'collaboration_native_import',
    'collaboration_feedback_roundtrip',
    'collaboration_explicit_accept',
    'collaboration_undo',
    'collaboration_stale_feedback_guidance',
    'collaboration_reload',
    'collaboration_revoke',
    'collaboration_no_ai_requests',
    'collaboration_package_scope',
  ];
}
