import { expect, test } from '@playwright/test';

test('outline chapters reorder and open as separate work items', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/');
  await page.getByRole('button', { name: '开始长文项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目标题', exact: true }).fill('章节工作台');
  await page
    .getByRole('textbox', { name: '写作目标', exact: true })
    .fill('验证章节可排序并独立打开');
  await page.getByRole('button', { name: '保存项目并编辑大纲' }).click();
  for (const title of ['背景', '方法', '结论']) {
    await page.getByRole('button', { name: '添加章节' }).click();
    await page
      .getByRole('textbox', { name: `章节标题 ${['背景', '方法', '结论'].indexOf(title) + 1}` })
      .fill(title);
  }
  await page
    .getByRole('button', { name: '调整章节顺序 1' })
    .dragTo(page.getByRole('button', { name: '调整章节顺序 3' }));
  await expect(page.getByRole('textbox', { name: '章节标题 1' })).toHaveValue('方法');
  await expect(page.getByRole('textbox', { name: '章节标题 3' })).toHaveValue('背景');
  await page.getByRole('button', { name: '调整章节顺序 3' }).press('Alt+ArrowUp');
  await expect(page.getByRole('textbox', { name: '章节标题 2' })).toHaveValue('背景');
  await page.getByRole('button', { name: '确认大纲，进入章节' }).click();
  await expect(page.getByRole('tab', { name: '章节工作台', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '方法', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page.getByRole('tab', { name: '章节工作台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '章节工作台', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /背景/ }).last().click();
  await expect(page.getByRole('tab', { name: '背景', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
});

test('projects are persistent work items independent of the sidebar browser', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/');
  await page.getByRole('button', { name: '开始长文项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目标题', exact: true }).fill('项目工作台验收');
  await page.getByRole('textbox', { name: '写作目标', exact: true }).fill('验证项目与文件共存');
  await page.getByRole('button', { name: '保存项目并编辑大纲' }).click();
  const projectTab = page.getByRole('tab', { name: '项目工作台验收', exact: true });
  await expect(projectTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: '当前项目' })).toBeVisible();
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await expect(projectTab).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'README.md', exact: true }).click();
  await expect(page.getByRole('region', { name: '当前文档' })).toBeVisible();
  await page.getByRole('tab', { name: '项目', exact: true }).click();
  const projectRow = page
    .getByRole('complementary', { name: '项目列表' })
    .getByRole('button', { name: /项目工作台验收/ });
  await expect(projectRow).not.toHaveAttribute('data-active', 'true');
  await projectRow.click();
  await expect(projectTab).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '目标与资料' }).click();
  await page.getByRole('textbox', { name: '写作目标', exact: true }).fill('尚未保存的项目目标');
  await expect(projectTab.locator('[aria-label="Unsaved"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close 项目工作台验收' }).click();
  const closeDialog = page.getByRole('dialog', { name: '关闭未保存的项目视图？' });
  await expect(closeDialog).toBeVisible();
  await closeDialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(projectTab).toBeVisible();
  await page.getByRole('button', { name: 'Close 项目工作台验收' }).click();
  await closeDialog.getByRole('button', { name: '关闭标签' }).click();
  await expect(projectTab).toHaveCount(0);
  await expect(projectRow).toBeVisible();
});

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
    await page.getByRole('button', { name: '开始长文项目', exact: true }).click();
    const save = page.getByRole('button', { name: '保存项目并编辑大纲' });
    await expect(save).not.toBeInViewport();
    await page.getByRole('heading', { name: '新建长文项目', exact: true }).hover();
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
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/');
  await page.getByRole('button', { name: '开始长文项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目标题', exact: true }).fill('星河长文验收');
  await page
    .getByRole('textbox', { name: '写作目标', exact: true })
    .fill('写一份保留事实的项目报告');
  await page
    .getByRole('textbox', { name: '关键事实与未决事项', exact: true })
    .fill('预算 420 元，尚未批准；截止日 2026 年 10 月 15 日。');
  await page.getByRole('button', { name: '保存项目并编辑大纲' }).click();
  await page.getByRole('button', { name: 'AI 生成大纲' }).click();
  const confirmation = page.getByRole('dialog', { name: '确认本次 AI 使用范围' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByText('项目目标、读者、关键事实、术语与大纲')).toBeVisible();
  await expect(confirmation.getByText('其他工作区文件、最近对话、未选择的个人资料')).toBeVisible();
  await confirmation.getByRole('button', { name: '确认并开始本次生成' }).click();
  await expect(page.getByRole('textbox', { name: '章节标题 1', exact: true })).toHaveValue(
    '背景与目标'
  );
  await page.getByRole('textbox', { name: '章节标题 1', exact: true }).fill('背景与事实');
  await page.getByRole('button', { name: '确认大纲，进入章节' }).click();
  await expect(page.getByRole('tab', { name: '背景与事实', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('button', { name: '继续写', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存为成果' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '规划本章生成' })).toBeEnabled();
  await page.getByRole('button', { name: '规划本章生成' }).click();
  await expect(confirmation.getByText('当前章节：背景与事实')).toBeVisible();
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
  await page.getByRole('region', { name: '继续最近项目' }).getByRole('button').click();
  await page.getByRole('tab', { name: /3 正文与审稿/ }).click();
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
  await page.getByRole('button', { name: '保存为成果' }).click();
  await expect(
    page.getByRole('heading', { name: '星河长文验收', exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByText('星河预算 420 元，尚未批准。已人工编辑。', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  await page.getByRole('region', { name: '继续最近项目' }).getByRole('button').click();
  await page.getByRole('tab', { name: '背景与事实', exact: true }).click();
  await page
    .getByRole('textbox', { name: '章节正文', exact: true })
    .fill('星河预算 420 元，尚未批准。第二版已核对。');
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '接受本章正文与摘要' }).click();
  await page.getByRole('tab', { name: '星河长文验收', exact: true }).first().click();
  await expect(page.getByText('内容比成果更新')).toBeVisible();
  await page.getByRole('button', { name: '查看成果' }).click();
  await expect(
    page.getByText('星河预算 420 元，尚未批准。已人工编辑。', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  await page.getByRole('region', { name: '继续最近项目' }).getByRole('button').click();
  await page.getByRole('tab', { name: '行动建议', exact: true }).click();
  await page.getByRole('button', { name: '接受本章正文与摘要' }).click();
  await page.getByRole('tab', { name: '星河长文验收', exact: true }).first().click();
  await page.getByRole('button', { name: '更新成果', exact: true }).click();
  await expect(
    page.getByText('星河预算 420 元，尚未批准。第二版已核对。', { exact: true })
  ).toBeVisible();
});
