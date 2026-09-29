import { expect, test } from '@playwright/test';

test('document critic: local rules, retained ignore, confirmed review and accepted inline edit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 650 });
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/');
  await page.getByRole('button', { name: '新建成果' }).click();
  const create = page.getByRole('dialog', { name: '新建成果' });
  await create.getByLabel('成果标题').fill('M7 审稿');
  await create.getByLabel('本地文件名').fill('m7.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await page.getByText('编辑', { exact: true }).click();
  const editor = page.getByRole('textbox', { name: '成果编辑器' });
  const text = '# M7 审稿\n\n预算 420 元，尚未批准。';
  await editor.fill(text);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '文档审稿', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '文档审稿', exact: true });
  await expect(drawer.getByText('数字来源待核对')).toBeVisible();
  await drawer.getByRole('button', { name: '查看原文' }).click();
  const passage = page.getByRole('dialog', { name: '原文位置' });
  await expect(passage).toContainText('预算 420 元，尚未批准。');
  await passage.getByRole('button', { name: 'Close' }).click();
  await drawer.getByRole('button', { name: /忽\s*略/ }).click();
  await expect(drawer.getByRole('button', { name: '让 AI 修改' })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Close' }).click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '成果', exact: true })
    .click();
  await page
    .getByRole('article')
    .filter({ hasText: 'M7 审稿' })
    .getByRole('button', { name: /继续处理/ })
    .click();
  await page.getByRole('button', { name: '文档审稿', exact: true }).click();
  await drawer.getByRole('checkbox', { name: '显示已忽略提示' }).check();
  await expect(drawer.getByRole('button', { name: '让 AI 修改' })).toBeDisabled();
  await drawer.getByRole('button', { name: '恢复提示' }).click();
  await drawer.getByRole('button', { name: 'AI 深度审稿' }).click();
  const confirm = page.getByRole('dialog', { name: '确认本次审稿发送范围' });
  await expect(confirm).toContainText('待审稿正文');
  await confirm.getByRole('button', { name: '确认并开始' }).click();
  await expect(drawer.getByText('AI 建议（待人工核对）')).toBeVisible();
  await drawer.getByRole('button', { name: '让 AI 修改' }).click();
  await confirm.getByRole('button', { name: '确认并开始' }).click();
  const proposal = page.getByRole('dialog', { name: '审阅修改提案' });
  await expect(proposal).toContainText('修改前');
  await proposal.getByRole('button', { name: '接受并写入' }).click();
  await expect(proposal).toBeHidden();
  await expect(drawer.getByText('AI 建议（待人工核对）')).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Close' }).click();
  await page.getByText('编辑', { exact: true }).click();
  await expect(editor).toContainText('预算 420 元，尚未批准。');
  await expect(editor).not.toHaveValue(text);
});
