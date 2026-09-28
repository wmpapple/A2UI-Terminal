import { expect, test } from '@playwright/test';

test('unknown citations never claim verification and the source preview can be closed', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('a2ui.onboarding-complete.v1', 'true');
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新建成果' }).click();
  const create = page.getByRole('dialog', { name: '新建成果' });
  await create.getByLabel('成果标题').fill('引用验证');
  await create.getByLabel('本地文件名').fill('citation-test.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await page.getByText('编辑', { exact: true }).click();
  await page.getByRole('textbox', { name: '成果编辑器' }).fill('预算 420 元 [S999]');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const sources = page.getByRole('region', { name: '引用来源' });
  await expect(sources.getByRole('button', { name: /\[S999\].*未知引用/ })).toBeVisible();
  await sources.getByRole('button', { name: /\[S999\]/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('未知引用', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/当前引用无法显示已核验原文/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('textbox', { name: '成果编辑器' })).toHaveValue('预算 420 元 [S999]');
});
