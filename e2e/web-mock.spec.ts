import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
});

const openProfessionalWorkbench = async (page: import('@playwright/test').Page) => {
  await skipOnboarding(page);
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: /设置$/ }).click();
  await page.getByText('专业模式', { exact: true }).click();
  await navigation.getByRole('button', { name: /工作台$/ }).click();
  await expect(page.getByTestId('workspace-layout')).toBeVisible();
};

const skipOnboarding = async (page: import('@playwright/test').Page) => {
  const skip = page.getByRole('button', { name: '跳过引导' });
  if (await skip.isVisible()) await skip.click();
};

test('aligns all six fixed task-card contents to the same inset', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.reload();
  const contents = page.getByTestId('home-action-content');
  await expect(contents).toHaveCount(6);

  const geometry = await contents.evaluateAll((elements) =>
    elements.map((element) => {
      const content = element.getBoundingClientRect();
      const button = element.closest('button')?.getBoundingClientRect();
      if (!button) throw new Error('task-card content must stay inside its button');
      return {
        leftInset: content.left - button.left,
        rightInset: button.right - content.right,
      };
    })
  );

  const leftInsets = geometry.map(({ leftInset }) => leftInset);
  const rightInsets = geometry.map(({ rightInset }) => rightInset);
  expect(Math.max(...leftInsets) - Math.min(...leftInsets)).toBeLessThan(0.5);
  expect(Math.max(...rightInsets) - Math.min(...rightInsets)).toBeLessThan(0.5);
});

test('completes the first-run guide and creates a local Result scaffold from Home', async ({
  page,
}) => {
  const onboarding = page.getByRole('dialog', { name: '欢迎使用 A2UI 工作台' });
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole('radio', { name: '整理一组资料' }).click();
  await onboarding.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(onboarding.getByText(/已准备 4 项资料/)).toBeVisible();
  await onboarding.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(onboarding.getByText(/匿名改进指标默认关闭/)).toBeVisible();
  await onboarding.getByRole('checkbox').check();
  await onboarding.getByRole('button', { name: '完成并进入首页' }).click();

  await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible();
  await expect(page.getByText('A2UI 调研纪要')).toBeVisible();
  await page.getByRole('button', { name: /整理一组资料/ }).click();

  const taskDialog = page.getByRole('dialog', { name: '创建本地成果草稿' });
  await expect(taskDialog.getByText(/尚未调用 AI 生成正文/)).toBeVisible();
  await taskDialog.getByRole('button', { name: /会议纪要/ }).click();
  await taskDialog.getByLabel('请提供会议主题').fill('产品例会');
  await taskDialog.getByRole('button', { name: '创建结构草稿' }).click();
  await expect(taskDialog.getByText('本地结构草稿已创建')).toBeVisible();
  await expect(taskDialog.getByText('会议纪要 - 产品例会')).toBeVisible();
  await taskDialog.getByRole('button', { name: /去工作台继续/ }).click();
  await expect(page).toHaveURL(/#\/workbench$/);
});

test('defaults to the simple navigation shell and persists professional mode', async ({ page }) => {
  await skipOnboarding(page);
  await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible();
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

  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('radio', { name: '编辑器' })).toBeChecked();
  await expect(page.getByText('Research profile')).toHaveCount(0);

  await page.getByText('交互成果', { exact: true }).click();
  await expect(page.getByText('Research profile')).toBeVisible();

  await page
    .getByRole('button', { name: /永久删除/ })
    .first()
    .click();
  const confirmation = page.getByText('永久删除当前交互成果？');
  await expect(confirmation).toBeVisible();
  await page.getByRole('button', { name: /取.*消/ }).click();
  await expect(page.getByText('Research profile')).toBeVisible();

  await page
    .getByRole('button', { name: /永久删除/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: /永久删除/ })
    .last()
    .click();
  await expect(page.getByRole('radio', { name: '编辑器' })).toBeChecked();
  await expect(page.getByText('Research profile')).toHaveCount(0);
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

test('creates, saves, versions, copies, and reopens a text Result without chat', async ({
  page,
}) => {
  await skipOnboarding(page);
  await page.getByRole('button', { name: '新建文本成果' }).click();
  const create = page.getByRole('dialog', { name: '新建文本成果' });
  await create.getByLabel('成果标题').fill('S1.5 验收记录');
  await create.getByLabel('本地文件名').fill('S1.5-验收记录.md');
  await create.getByRole('button', { name: '创建并打开' }).click();

  await expect(page).toHaveURL(/#\/workbench$/);
  await expect(page.getByText('S1.5 验收记录', { exact: true })).toBeVisible();
  await expect(page.getByText(/当前成果不会自动发送/)).toBeVisible();
  const editor = page.getByRole('textbox', { name: '成果编辑器' });
  await editor.fill('# S1.5 验收记录\n\n成果正文已保存。');
  await expect(page.getByText('有未保存修改')).toBeVisible();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 5000 });

  await page.getByRole('button', { name: /历史版本/ }).click();
  await expect(page.getByText('创建成果')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /另存副本/ }).click();
  await expect(page.getByText('S1.5 验收记录 - 副本', { exact: true })).toBeVisible();

  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: /成果$/ }).click();
  await expect(page.getByText('S1.5 验收记录', { exact: true })).toBeVisible();
  await expect(page.getByText('S1.5 验收记录 - 副本', { exact: true })).toBeVisible();
  const original = page.getByRole('article').filter({ hasText: 'S1.5 验收记录' }).last();
  await original.getByRole('button', { name: /继续处理/ }).click();
  await expect(editor).toHaveValue('# S1.5 验收记录\n\n成果正文已保存。');
});

test('reviews an ImportBatch before authorizing only currently readable sources', async ({
  page,
}) => {
  await skipOnboarding(page);
  await page.getByTestId('home-source-drop-zone').dispatchEvent('drop');
  const review = page.getByRole('dialog', { name: '确认读取范围' });
  await expect(review).toBeVisible();
  await expect(review.getByText('meeting-notes.md')).toBeVisible();
  await expect(review.getByText('research-report.docx')).toBeVisible();
  await expect(review.getByText('表格适配待开放')).toBeVisible();
  await expect(review.getByText('图片上下文待开放')).toBeVisible();
  await expect(review.getByText('隐藏文件、密钥或敏感路径不会加入导入批次')).toBeVisible();
  await expect(review.getByRole('checkbox', { name: /sales.xlsx/ })).toBeDisabled();
  await expect(review.getByRole('checkbox', { name: /whiteboard.png/ })).toBeDisabled();
  await expect(review.getByText(/确认前不建立授权/)).toBeVisible();

  await review.getByRole('button', { name: /取.*消/ }).click();
  await expect(review).toHaveCount(0);
  await page.getByRole('button', { name: /选择资料/ }).click();
  const confirmation = page.getByRole('dialog', { name: '确认读取范围' });
  await confirmation.getByRole('button', { name: '确认加入资料' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByText(/已准备 6 项资料/)).toBeVisible();
});
