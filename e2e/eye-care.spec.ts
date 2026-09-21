import { expect, test } from '@playwright/test';

test('eye comfort preserves editing, persists and stays scoped to the workbench', async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/');
  await page.getByRole('button', { name: /新建成果$/ }).click();
  const dialog = page.getByRole('dialog', { name: '新建成果' });
  await dialog.getByLabel('成果标题').fill('护眼模式检查');
  await dialog.getByLabel('本地文件名').fill('eye-care.md');
  await dialog.getByRole('button', { name: '创建并打开' }).click();
  await page.getByText('编辑', { exact: true }).click();
  const editor = page.getByRole('textbox', { name: '成果编辑器' });
  const content = '# 保留内容\n\n切换外观时继续编辑。';
  await editor.fill(content);
  const toggle = page.getByRole('switch', { name: '护眼模式' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(editor).toHaveValue(content);
  await expect(editor).toHaveCSS('background-color', 'rgb(245, 241, 227)');
  await page.screenshot({ path: info.outputPath('eye-care-light.png') });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(editor).toHaveCSS('background-color', 'rgb(41, 44, 36)');
  await expect(editor).toHaveValue(content);
  await page.screenshot({ path: info.outputPath('eye-care-dark.png') });
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('button', { name: '首页', exact: true }).click();
  await expect(toggle).toHaveCount(0);
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(11, 15, 25)');
  await nav.getByRole('button', { name: '工作台', exact: true }).click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await page.reload();
  await expect(toggle).not.toBeChecked();
});
