import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('workspace-layout')).toBeVisible();
});

test('shows the three-column Web Mock workspace and switches language', async ({ page }) => {
  await expect(page.getByRole('complementary', { name: '项目文件' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'AI 助手' })).toBeVisible();
  await expect(page.getByText('Web Mock', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '中文' }).click();
  await page.getByText('English', { exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Project files' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});

test('completes context review and renders a trusted A2UI surface', async ({ page }) => {
  await page.getByPlaceholder('描述你希望对当前文件做出的修改…').fill('Create an A2UI form');
  await page.getByRole('button', { name: '发送' }).click();

  const review = page.getByRole('dialog', { name: '发送前确认上下文' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: '确认并发送' }).click();

  await expect(page.getByText('A2UI 安全运行时')).toBeVisible();
  await expect(page.getByText('协议 Inspector')).toBeVisible();
  await expect(page.getByText('Research profile')).toBeVisible();
});

test('keeps file changes behind review before applying the Web Mock patch', async ({ page }) => {
  await page.getByPlaceholder('描述你希望对当前文件做出的修改…').fill('Update the sample count');
  await page.getByRole('button', { name: '发送' }).click();
  await page
    .getByRole('dialog', { name: '发送前确认上下文' })
    .getByRole('button', { name: '确认并发送' })
    .click();

  await expect(page.getByRole('region', { name: '审阅中心' })).toBeVisible();
  await expect(page.getByText('已通过 Rust 校验')).toBeVisible();
  await page.getByRole('button', { name: /应用已选修改/ }).click();
  await expect(page.getByRole('radio', { name: '编辑器' })).toBeChecked();
  await expect(page.getByRole('button', { name: /撤销上次 Patch/ })).toBeVisible();
});
