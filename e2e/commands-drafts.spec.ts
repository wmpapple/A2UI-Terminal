import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/');
});

test('commands navigate, search authorized content and create results with keyboard', async ({
  page,
}) => {
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: '搜索与快捷命令' });
  const command = palette.getByRole('combobox', { name: '搜索与快捷命令' });
  await command.fill('设置');
  await command.press('Enter');
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(command).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette).not.toBeVisible();
  await page.getByRole('button', { name: '搜索与快捷命令', exact: true }).click();
  const search = palette.getByPlaceholder('输入成果标题、正文关键词或资料名称');
  await search.fill('调研');
  await search.press('Enter');
  await expect(palette.getByText('A2UI 调研纪要', { exact: true })).toBeVisible();
  await command.fill('新建');
  await command.press('Enter');
  const create = page.getByRole('dialog', { name: '新建成果' });
  await expect(create).toBeVisible();
  await create.getByLabel('成果标题').fill('命令面板创建');
  await create.getByLabel('本地文件名').fill('command-created.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await expect(page.getByRole('heading', { name: '命令面板创建' })).toBeVisible();
});

test('draft survives navigation, sessions remain isolated, shortcuts keep context confirmation', async ({
  page,
}) => {
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('button', { name: '工作台', exact: true }).click();
  const prompt = page.getByRole('textbox', {
    name: '描述你希望对当前文件做出的修改…',
    exact: true,
  });
  await prompt.fill('尚未发送的草稿');
  await nav.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await nav.getByRole('button', { name: '工作台', exact: true }).click();
  await expect(prompt).toHaveValue('尚未发送的草稿');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(prompt).toHaveValue('');
  await page.getByRole('button', { name: '解释这段内容', exact: true }).click();
  await expect(prompt).toHaveValue('解释这段内容');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await prompt.press('Control+Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(prompt).toHaveValue('解释这段内容');
});
