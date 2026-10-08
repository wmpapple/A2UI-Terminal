import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('a2ui.onboarding-complete.v1', 'true');
  });
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: /设置$/ }).click();
  await page.getByRole('combobox', { name: '界面模式' }).selectOption('professional');
  await navigation.getByRole('button', { name: /工作台$/ }).click();
  await expect(page.getByTestId('workspace-layout')).toBeVisible();
  await expect(page.getByRole('region', { name: '当前文档', exact: true })).toBeVisible();
});

for (const width of [1280, 1000]) {
  test(`preserves drafts while collapsing both panels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const layout = page.getByTestId('workspace-layout');
    const assistant = page.getByRole('complementary', { name: 'AI 助手', exact: true });
    const prompt = page.getByPlaceholder('描述你希望对当前文档做出的修改…');
    await prompt.fill('保留这条未发送草稿');
    const before = await layout.locator('main').boundingBox();
    await page.getByRole('button', { name: '收起 AI 栏' }).click();
    await expect(assistant).toBeHidden();
    await page.getByRole('button', { name: '收起文件栏' }).click();
    await expect(layout.getByRole('separator')).toHaveCount(0);
    const after = await layout.locator('main').boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 400);
    await page.getByRole('button', { name: '展开 AI 栏' }).click();
    await page.getByRole('button', { name: '展开文件栏' }).click();
    await expect(prompt).toHaveValue('保留这条未发送草稿');
    await expect(layout.getByRole('separator', { name: /调整.*宽度/ })).toHaveCount(2);
    const overflowing = await layout.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1
    );
    expect(overflowing).toBe(false);
  });
}

test('document tasks fill the composer and advanced capabilities open only on demand', async ({
  page,
}) => {
  await page.getByRole('button', { name: '新建会话' }).click();
  const assistant = page.getByRole('complementary', { name: 'AI 助手', exact: true });
  await expect(assistant.getByRole('region', { name: '当前文档' })).toBeVisible();
  await assistant.getByRole('button', { name: '生成提纲' }).click();
  await expect(page.getByPlaceholder('描述你希望对当前文档做出的修改…')).toHaveValue(
    '根据当前文档生成提纲'
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '文档审稿', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '文档审稿', exact: true })).toBeVisible();
  await page
    .getByRole('dialog', { name: '文档审稿', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: '结构化编辑', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '结构化文档', exact: true })).toBeVisible();
});

test('keeps edit, split and preview views consistent after switching files', async ({ page }) => {
  const editor = page.getByTestId('workspace-layout').locator('main');
  const source = editor.locator('.cm-content');
  const preview = editor.locator('.md-editor-preview-wrapper');
  await expect(source).toBeVisible();
  await expect(preview).toBeHidden();
  await editor.getByText('分屏', { exact: true }).click();
  await expect(source).toBeVisible();
  await expect(preview).toBeVisible();
  await editor.getByText('预览', { exact: true }).click();
  await expect(source).toBeHidden();
  await expect(preview).toBeVisible();
  await page.getByText('src/experiment.ts', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'src/experiment.ts' })).toBeVisible();
  await editor.getByRole('tab', { name: 'README.md', exact: true }).click();
  await expect(editor.getByRole('radio', { name: '预览', exact: true })).toBeChecked();
  await expect(source).toBeHidden();
  await expect(preview).toBeVisible();
  await editor.getByText('编辑', { exact: true }).last().click();
  await expect(source).toBeVisible();
  await expect(preview).toBeHidden();
});

test('keeps the same three-column workbench when switching to tools', async ({ page }) => {
  const workbench = page.getByTestId('workspace-layout');
  const resources = workbench.getByRole('tablist', { name: '左侧资源视图' });
  await expect(resources).toBeVisible();
  await expect(workbench.getByRole('tab', { name: 'README.md' })).toBeVisible();
  await resources.getByRole('tab', { name: '工具' }).click();
  await expect(workbench.getByRole('tab', { name: 'README.md' })).toBeVisible();
  await expect(workbench.getByRole('region', { name: '当前文档' })).toBeVisible();
  await expect(workbench.getByRole('complementary', { name: 'AI 助手' })).toBeVisible();
  await page.getByRole('button', { name: '收起工具栏' }).click();
  await expect(page.getByRole('button', { name: '展开工具栏' })).toBeVisible();
  await workbench.getByRole('tab', { name: 'README.md' }).click();
  await expect(workbench.getByRole('region', { name: '当前文档' })).toBeVisible();
  await page.getByRole('button', { name: '展开工具栏' }).click();
  await resources.getByRole('tab', { name: '文件', exact: true }).click();
  await expect(workbench.getByRole('tab', { name: 'README.md' })).toBeVisible();
});
