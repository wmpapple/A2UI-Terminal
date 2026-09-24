import { expect, test, type Page } from '@playwright/test';

async function createDocument(page: Page) {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/');
  await page.getByRole('button', { name: '新建成果' }).click();
  const dialog = page.getByRole('dialog', { name: '新建成果' });
  await dialog.getByLabel('成果标题').fill('AI 验收');
  await dialog.getByLabel('本地文件名').fill('ai-review.md');
  await dialog.getByRole('button', { name: '创建并打开' }).click();
  await expect(page.getByRole('heading', { name: 'AI 验收' })).toBeVisible();
}
async function generate(page: Page, confirmScope = true) {
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认 AI 写作发送范围' });
  if (confirmScope) {
    await expect(confirmation.getByText('不发送资料正文，仅发送写作要求')).toBeVisible();
    await confirmation.getByRole('button', { name: '确认并生成' }).click();
    await expect(confirmation).toBeHidden();
  } else {
    await expect(confirmation).toHaveCount(0);
  }
  await expect(page.getByRole('textbox', { name: '写作要求' })).toHaveValue('');
  return page.getByRole('dialog', { name: '审阅 AI 写作提案' });
}

test('result generation is opt-in, requires review and can be undone', async ({ page }) => {
  await createDocument(page);
  await page.getByRole('button', { name: '上下文', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: '本次发送当前成果的已保存正文' })
  ).not.toBeChecked();
  await page
    .getByRole('dialog', { name: '本次发送范围' })
    .getByRole('button', { name: /^关\s*闭$/ })
    .click();
  await page.getByRole('textbox', { name: '写作要求' }).fill('写一份 420 项目进展报告');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认 AI 写作发送范围' })
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await expect(page.getByRole('textbox', { name: '写作要求' })).toHaveValue(
    '写一份 420 项目进展报告'
  );
  await expect(page.getByRole('dialog', { name: '审阅 AI 写作提案' })).toHaveCount(0);
  let review = await generate(page);
  await expect(review).toContainText('Web Mock 示例');
  await review.getByRole('button', { name: '拒绝提案' }).click();
  await page.getByText('编辑', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: '成果编辑器' })).toHaveValue('# AI 验收\n\n');
  await page.getByRole('textbox', { name: '写作要求' }).fill('改用更简洁的表达重新生成');
  review = await generate(page, false);
  await review.getByRole('button', { name: '接受并写入成果' }).click();
  await expect(review).toBeHidden();
  await expect(page.getByRole('textbox', { name: '成果编辑器' })).toHaveValue(/Web Mock 示例/);
  await page.getByRole('button', { name: '撤销本次 AI 修改', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '成果编辑器' })).toHaveValue('# AI 验收\n\n');
  await page.getByRole('button', { name: '修改发送清单', exact: true }).click();
  await page.getByRole('checkbox', { name: '本次发送当前成果的已保存正文' }).check();
  await page
    .getByRole('dialog', { name: '本次发送范围' })
    .getByRole('button', { name: /^关\s*闭$/ })
    .click();
  await page.getByRole('textbox', { name: '写作要求' }).fill('结合当前成果继续完善');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认 AI 写作发送范围' })).toBeVisible();
});

test('stopping writing leaves the result unchanged and allows a fresh attempt', async ({
  page,
}) => {
  await createDocument(page);
  await page
    .getByRole('textbox', { name: '写作要求' })
    .fill('生成一个详细报告，用于测试停止和恢复。'.repeat(30));
  await generate(page);
  await expect(page.getByText('本次发送清单', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '写作要求' })).toBeEditable();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog', { name: '审阅 AI 写作提案' })).toHaveCount(0);
  await page.getByText('编辑', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: '成果编辑器' })).toHaveValue('# AI 验收\n\n');
  await page.getByRole('textbox', { name: '写作要求' }).fill('停止后重新生成');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认 AI 写作发送范围' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '审阅 AI 写作提案' })).toBeVisible();
});

test('home navigation restores the active result, unsaved draft and writing setup', async ({
  page,
}) => {
  await createDocument(page);
  await page.getByText('编辑', { exact: true }).click();
  await page.getByRole('textbox', { name: '成果编辑器' }).fill('切换页面后仍需保留的成果内容');
  await page.getByRole('textbox', { name: '写作要求' }).fill('切换页面后仍需保留的写作要求');
  await page.getByRole('button', { name: '上下文', exact: true }).click();
  await page.getByRole('checkbox', { name: '本次发送当前成果的已保存正文' }).check();
  await page
    .getByRole('dialog', { name: '本次发送范围' })
    .getByRole('button', { name: /^关\s*闭$/ })
    .click();

  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: '首页', exact: true }).click();
  await navigation.getByRole('button', { name: '工作台', exact: true }).click();

  await expect(page.getByRole('region', { name: '成果工作区' })).toBeVisible();
  await page.getByText('编辑', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: '成果编辑器' })).toHaveValue(
    '切换页面后仍需保留的成果内容'
  );
  await expect(page.getByRole('textbox', { name: '写作要求' })).toHaveValue(
    '切换页面后仍需保留的写作要求'
  );
  await page.getByRole('button', { name: '上下文', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '本次发送当前成果的已保存正文' })).toBeChecked();
});

test('opening a workspace file asks before leaving the active result', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.experience-mode.v1', 'professional'));
  await createDocument(page);
  await page.getByText('编辑', { exact: true }).click();
  await page.getByRole('textbox', { name: '成果编辑器' }).fill('尚未保存的成果修改');

  const workspaceFile = page.getByRole('treeitem', { name: /README\.md/i });
  await workspaceFile.click();
  const confirmation = page.getByRole('dialog', { name: '打开工作区文件？' });
  await expect(confirmation).toContainText('当前成果有未保存修改');
  await confirmation.getByRole('button', { name: '留在当前成果' }).click();
  await expect(page.getByRole('region', { name: '成果工作区' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '成果编辑器' })).toHaveValue('尚未保存的成果修改');

  await workspaceFile.click();
  await page
    .getByRole('dialog', { name: '打开工作区文件？' })
    .getByRole('button', {
      name: '切换并打开',
    })
    .click();
  await expect(page.getByRole('region', { name: '成果工作区' })).toHaveCount(0);
  await expect(workspaceFile).toHaveAttribute('aria-selected', 'true');
});

test('home task can generate a reviewed AI result while retaining offline scaffolds', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/');
  await page.getByRole('button', { name: /整理一组资料/ }).click();
  const task = page.getByRole('dialog', { name: '创建任务成果' });
  await task.getByRole('button', { name: /会议纪要/ }).click();
  await task.getByLabel('会议主题').fill('星河评审');
  await expect(task.getByRole('button', { name: '创建结构草稿' })).toBeVisible();
  await task.getByRole('button', { name: '使用 AI 生成正文' }).click();
  await task.getByRole('button', { name: '发送', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认 AI 写作发送范围' })
    .getByRole('button', { name: '确认并生成' })
    .click();
  const review = page.getByRole('dialog', { name: '审阅 AI 写作提案' });
  await review.getByRole('textbox', { name: '成果文件名' }).fill('meeting-ai.md');
  await review.getByRole('button', { name: '接受并写入成果' }).click();
  await expect(page).toHaveURL(/#\/workbench$/);
  await expect(page.getByText(/Web Mock 示例/).first()).toBeVisible();
});
