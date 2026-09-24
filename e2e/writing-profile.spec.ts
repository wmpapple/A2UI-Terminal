import { expect, test } from '@playwright/test';

test('the global writing profile appears in the reviewed send manifest', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('a2ui.onboarding-complete.v1', 'true');
    localStorage.setItem('a2ui.experience-mode.v1', 'professional');
  });
  await page.goto('/#/settings');

  const profile = page.getByRole('region', { name: '写作方式设置' });
  await expect(profile).toBeVisible();
  await profile.getByRole('switch').click();
  await profile.getByLabel('写作规则').fill('先给结论，使用短句。');
  await profile.getByRole('button', { name: '添加术语' }).click();
  await profile.getByRole('textbox', { name: '原术语' }).fill('AI');
  await profile.getByRole('textbox', { name: '推荐写法' }).fill('人工智能');
  await profile.getByRole('combobox', { name: '禁用词' }).fill('赋能');
  await profile.getByRole('combobox', { name: '禁用词' }).press('Enter');
  await expect(profile.getByText('保存后规则预览')).toBeVisible();
  await expect(profile.getByText('未保存', { exact: true })).toBeVisible();
  await expect(profile.getByText('0 tokens', { exact: true })).toHaveCount(0);
  await expect(profile.getByText(/全局偏好：/)).toBeVisible();
  await expect(profile.getByText(/推荐术语：/)).toBeVisible();
  await expect(profile.getByText(/避免使用：赋能/)).toBeVisible();
  await expect(
    profile.getByText(/Global Profile:|Preferred terminology|Avoid these words/)
  ).toHaveCount(0);
  await profile.getByRole('button', { name: '保存偏好' }).click();
  await expect(profile.getByText(/应用层：全局偏好/)).toBeVisible();
  await expect(profile.getByText(/版本 2|v2/)).toHaveCount(0);

  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /工作台$/ })
    .click();
  await page.getByPlaceholder('描述你希望对当前文件做出的修改…').fill('写一段产品说明');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '发送前确认上下文' });
  await dialog.getByRole('button', { name: '生成发送清单' }).click();
  await expect(dialog.getByText('全局偏好', { exact: true })).toBeVisible();
  await expect(dialog.getByText('m2.1')).toBeVisible();
  await expect(dialog.getByText(/^快照 /)).toBeVisible();
  await dialog.getByText('查看本次有效规则').click();
  await expect(dialog.getByText(/先给结论，使用短句/)).toBeVisible();
  await expect(dialog.getByText(/全局偏好：/)).toBeVisible();
  await expect(dialog.getByText(/AI → 人工智能/)).toBeVisible();
  await expect(
    dialog.getByText(/Global Profile:|Preferred terminology|Avoid these words/)
  ).toHaveCount(0);
});
