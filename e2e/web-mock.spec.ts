import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
});

const openProfessionalWorkbench = async (page: import('@playwright/test').Page) => {
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: /设置$/ }).click();
  await page.getByText('专业模式', { exact: true }).click();
  await navigation.getByRole('button', { name: /工作台$/ }).click();
  await expect(page.getByTestId('workspace-layout')).toBeVisible();
};

test('defaults to the simple navigation shell and persists professional mode', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '从成果开始' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByRole('button', { name: '首页' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('简单模式', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '项目文件' })).toHaveCount(0);
  await expect(page.getByText('协议 Inspector')).toHaveCount(0);

  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: /成果$/ }).click();
  await expect(page.getByRole('heading', { name: '我的成果' })).toBeVisible();
  await navigation.getByRole('button', { name: /模板$/ }).click();
  await expect(page.getByRole('heading', { name: '模板' })).toBeVisible();

  await navigation.getByRole('button', { name: /工作台$/ }).click();
  await expect(page.getByTestId('workspace-layout')).toBeVisible();
  await expect(page.getByRole('complementary', { name: '项目文件' })).toHaveCount(0);
  await expect(page.getByText('协议 Inspector')).toHaveCount(0);
  await expect(page.getByText(/siliconflow/i)).toHaveCount(0);
  await expect(page.getByText('Endpoint', { exact: true })).toHaveCount(0);
  await expect(page.getByText('API Key', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /选择文件/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '新对话' })).toBeVisible();
  await page.getByRole('button', { name: '新对话' }).click();
  await expect(page.getByText('选择上下文后告诉我需要修改什么。')).toHaveCount(0);

  await navigation.getByRole('button', { name: /设置$/ }).click();
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Provider 高级设置/ })).toHaveCount(0);
  await expect(page.getByText('Endpoint', { exact: true })).toHaveCount(0);
  await expect(page.getByText('API Key', { exact: true })).toHaveCount(0);

  await page.getByText('专业模式', { exact: true }).click();
  await expect(page.getByRole('button', { name: /Provider 高级设置/ })).toBeVisible();
  await navigation.getByRole('button', { name: /工作台$/ }).click();
  await expect(page.getByRole('complementary', { name: '项目文件' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'AI 助手' })).toBeVisible();
  await expect(page.getByText('Web Mock', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/workbench$/);

  await page.reload();
  await expect(page.getByText('专业模式', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '项目文件' })).toBeVisible();

  await page.getByRole('button', { name: '中文' }).click();
  await page.getByText('English', { exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Project files' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});

test('completes context review and renders a trusted A2UI surface', async ({ page }) => {
  await openProfessionalWorkbench(page);
  await page.getByPlaceholder('描述你希望对当前文件做出的修改…').fill('Create an A2UI form');
  await page.getByRole('button', { name: '发送' }).click();

  const review = page.getByRole('dialog', { name: '发送前确认上下文' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: '确认并发送' }).click();

  await expect(page.getByText('A2UI 安全运行时')).toBeVisible();
  await expect(page.getByText('协议 Inspector')).toBeVisible();
  await expect(page.getByText('Research profile')).toBeVisible();

  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /设置$/ })
    .click();
  await page.getByText('简单模式', { exact: true }).click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /工作台$/ })
    .click();
  await expect(page.getByText('Research profile')).toBeVisible();
  await expect(page.getByText('协议 Inspector')).toHaveCount(0);
});

test('keeps file changes behind review before applying the Web Mock patch', async ({ page }) => {
  await openProfessionalWorkbench(page);
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
