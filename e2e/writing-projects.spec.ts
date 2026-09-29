import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1000, height: 650 },
]) {
  test(`long-form form scrolls with the mouse at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
    await page.goto('/');
    await page.getByRole('button', { name: '长文项目', exact: true }).click();
    const save = page.getByRole('button', { name: '保存项目并编辑大纲' });
    await expect(save).not.toBeInViewport();
    await page.getByRole('heading', { name: '我的长文项目', exact: true }).hover();
    await page.mouse.wheel(0, 1600);
    await expect(save).toBeInViewport();
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeInViewport();
    await page.mouse.wheel(0, -1600);
    await expect(page.getByRole('textbox', { name: '项目标题', exact: true })).toBeInViewport();
  });
}

test('long-form outline, section drafts, navigation recovery and final result', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/');
  await page.getByRole('button', { name: '长文项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目标题', exact: true }).fill('星河长文验收');
  await page
    .getByRole('textbox', { name: '写作目标', exact: true })
    .fill('写一份保留事实的项目报告');
  await page
    .getByRole('textbox', { name: '关键事实与未决事项', exact: true })
    .fill('预算 420 元，尚未批准；截止日 2026 年 10 月 15 日。');
  await page.getByRole('button', { name: '保存项目并编辑大纲' }).click();
  await page.getByRole('button', { name: 'AI 生成大纲' }).click();
  const confirmation = page.getByRole('dialog', { name: '确认本次长文发送范围' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '确认并开始本次生成' }).click();
  await expect(page.getByRole('textbox', { name: '章节标题 1', exact: true })).toHaveValue(
    '背景与目标'
  );
  await page.getByRole('textbox', { name: '章节标题 1', exact: true }).fill('背景与事实');
  await page.getByRole('button', { name: '确认大纲，进入章节' }).click();
  await expect(page.getByRole('button', { name: '合成为最终成果' })).toBeDisabled();
  await page.getByRole('button', { name: '规划本章生成' }).click();
  await confirmation.getByRole('button', { name: '确认并开始本次生成' }).click();
  const content = page.getByRole('textbox', { name: '章节正文', exact: true });
  await expect(content).toContainText('预算 420');
  await content.fill('星河预算 420 元，尚未批准。已人工编辑。');
  await page
    .getByRole('textbox', { name: '本章事实摘要', exact: true })
    .fill('预算 420 元，尚未批准');
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  await page.getByRole('button', { name: '长文项目', exact: true }).click();
  await expect(content).toHaveValue('星河预算 420 元，尚未批准。已人工编辑。');
  await page.getByRole('button', { name: '接受本章正文与摘要' }).click();
  await page.getByRole('combobox', { name: '当前章节' }).click();
  await page.getByText('2. 行动建议 · 待审阅', { exact: true }).click();
  await page.getByRole('button', { name: '规划本章生成' }).click();
  await confirmation.getByRole('button', { name: '确认并开始本次生成' }).click();
  await page
    .getByRole('textbox', { name: '本章事实摘要', exact: true })
    .fill('截止日 2026 年 10 月 15 日');
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '接受本章正文与摘要' }).click();
  await page.getByRole('button', { name: '合成为最终成果' }).click();
  await expect(
    page.getByRole('heading', { name: '星河长文验收', exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByText('星河预算 420 元，尚未批准。已人工编辑。', { exact: true })
  ).toBeVisible();
});
