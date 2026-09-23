import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('a2ui-e2e-storage-ready') === 'true') return;
    localStorage.clear();
    sessionStorage.setItem('a2ui-e2e-storage-ready', 'true');
  });
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

const selectEditorText = async (
  editor: import('@playwright/test').Locator,
  selectedText: string
) => {
  await editor.evaluate((element, text) => {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
    const content = nodes.map((node) => node.data).join('');
    const start = content.indexOf(text);
    if (start < 0) throw new Error(`Could not find "${text}" in the editor`);
    const boundary = (offset: number) => {
      let consumed = 0;
      for (const node of nodes) {
        if (offset <= consumed + node.data.length) return { node, offset: offset - consumed };
        consumed += node.data.length;
      }
      throw new Error('Editor selection boundary is outside the document');
    };
    const from = boundary(start);
    const to = boundary(start + text.length);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const selection = window.getSelection();
    if (!selection) throw new Error('Browser selection is unavailable');
    (element as HTMLElement).focus();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, selectedText);
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
  await page.getByRole('button', { name: '发送', exact: true }).click();

  const review = page.getByRole('dialog', { name: '发送前确认上下文' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: '生成发送清单' }).click();
  await review.getByRole('button', { name: '确认并发送' }).click();

  await expect(page.getByText('A2UI 安全运行时')).toBeVisible();
  await expect(page.getByText('协议 Inspector')).toBeVisible();
  await expect(page.getByText('Research profile')).toBeVisible();

  await page.getByPlaceholder('描述你希望对当前文件做出的修改…').fill('Create another A2UI form');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(review).toBeHidden();
  await expect(page.getByText('Create another A2UI form', { exact: true })).toBeVisible();

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
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const contextReview = page.getByRole('dialog', { name: '发送前确认上下文' });
  await contextReview.getByRole('button', { name: '生成发送清单' }).click();
  await contextReview.getByRole('button', { name: '确认并发送' }).click();

  await expect(page.getByRole('region', { name: '审阅中心' })).toBeVisible();
  await expect(page.getByText('已通过 Rust 校验')).toBeVisible();
  await page.getByRole('button', { name: /应用已选修改/ }).click();
  await expect(page.getByRole('radio', { name: '编辑器' })).toBeChecked();
  await expect(page.getByRole('button', { name: /撤销上次 AI 修改/ })).toBeVisible();
});

test('routes selection edits through review and keeps explanations read-only', async ({ page }) => {
  await openProfessionalWorkbench(page);
  await page.getByText('src/experiment.ts', { exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'src/experiment.ts' });
  const original = await editor.textContent();
  await selectEditorText(editor, 'context-window');

  const assistant = page.getByRole('region', { name: '选区助手' });
  await expect(assistant).toBeVisible();
  await assistant.getByRole('button', { name: /润\s*色/ }).click();
  const confirmation = page.getByRole('dialog', { name: '确认使用当前选区' });
  await expect(confirmation.getByText(/接受前不会写入编辑器或文件/)).toBeVisible();
  await confirmation.getByRole('button', { name: '生成审阅方案' }).click();
  await expect(page.getByRole('region', { name: '审阅中心' })).toBeVisible();
  await page.getByRole('button', { name: '全部拒绝' }).click();
  await expect(editor).toHaveText(original ?? '');

  await selectEditorText(editor, 'context-window');
  await assistant.getByRole('button', { name: /解\s*释/ }).click();
  await confirmation.getByRole('button', { name: '生成解释' }).click();
  await expect(page.getByText('这是对当前选区的只读解释。编辑器和文件均未修改。')).toBeVisible();
  await expect(page.getByRole('region', { name: '审阅中心' })).toHaveCount(0);
  await expect(editor).toHaveText(original ?? '');
});

test('keeps AI-created travel documents behind a complete create-file review', async ({ page }) => {
  await openProfessionalWorkbench(page);
  const composer = page.getByPlaceholder('描述你希望对当前文件做出的修改…');
  const send = page.getByRole('button', { name: '发送', exact: true });

  await composer.fill('生成一份杭州三日游文档');
  await send.click();
  const contextReview = page.getByRole('dialog', { name: '发送前确认上下文' });
  await contextReview.getByRole('button', { name: '生成发送清单' }).click();
  await contextReview.getByRole('button', { name: '确认并发送' }).click();

  await expect(page.getByText('AI 已生成可审阅方案')).toBeVisible();
  await expect(page.getByText(/接受后将保存到“我的成果”/)).toBeVisible();
  await expect(page.getByText(/create_file/)).toHaveCount(0);
  const review = page.getByRole('region', { name: '审阅中心' });
  await expect(review).toBeVisible();
  await expect(review.getByLabel('确认创建后的文件名')).toHaveValue('杭州三日游.md');
  await expect(review.getByText(/抵达杭州并游览西湖/)).toBeVisible();
  await review.getByRole('button', { name: '全部拒绝' }).click();
  await expect(page.getByText('杭州三日游.md', { exact: true })).toHaveCount(0);

  await composer.fill('重新生成杭州三日游文档');
  await send.click();
  await expect(contextReview).toBeHidden();
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: /应用已选修改/ }).click();
  await expect(page.getByLabel('成果预览')).toBeVisible();
  await expect(page.getByRole('heading', { name: '杭州三日游' })).toBeVisible();
  await expect(page.getByText(/保存在“我的成果”/)).toBeVisible();
  await expect(page.getByText('杭州三日游.md', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /查看我的成果/ }).click();
  const reopened = page.getByRole('article').filter({ hasText: '杭州三日游' });
  await reopened.getByRole('button', { name: /继续处理/ }).click();
  await expect(page.getByRole('button', { name: /撤销上次 AI 修改/ })).toBeVisible();
  await page.getByRole('button', { name: /撤销上次 AI 修改/ }).click();
  await expect(page).toHaveURL(/#\/results$/);
  await expect(page.getByText(/已撤销上次 AI 修改/)).toBeVisible();
  await expect(page.getByText('杭州三日游', { exact: true })).toHaveCount(0);
});

test('creates, saves, versions, copies, and reopens a text Result without chat', async ({
  page,
}) => {
  await skipOnboarding(page);
  await page.getByRole('button', { name: '新建成果' }).click();
  const create = page.getByRole('dialog', { name: '新建成果' });
  await create.getByLabel('成果标题').fill('S1.5 验收记录');
  await create.getByLabel('本地文件名').fill('S1.5-验收记录.md');
  await create.getByRole('button', { name: '创建并打开' }).click();

  await expect(page).toHaveURL(/#\/workbench$/);
  await expect(page.getByRole('heading', { name: 'S1.5 验收记录' })).toBeVisible();
  await expect(page.getByText(/当前成果不会自动发送/)).toBeVisible();
  await page.getByText('编辑', { exact: true }).click();
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
  await page.getByText('编辑', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: '成果编辑器' })).toHaveValue(
    '# S1.5 验收记录\n\n成果正文已保存。'
  );
});

test('exports the saved Result through an explicitly labelled Web Mock dialog', async ({
  page,
}) => {
  await skipOnboarding(page);
  await page.getByRole('button', { name: '新建成果' }).click();
  const create = page.getByRole('dialog', { name: '新建成果' });
  await create.getByLabel('成果标题').fill('S2.8 导出测试');
  await create.getByLabel('本地文件名').fill('export-test.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await page.getByText('编辑', { exact: true }).click();
  await page.getByRole('textbox', { name: '成果编辑器' }).fill('# 中文导出\n\n当前版本');
  await page.getByRole('button', { name: /导出$/ }).click();
  const modal = page.getByRole('dialog', { name: '导出', exact: true });
  await expect(modal.getByText(/Web Mock 仅演示/)).toBeVisible();
  await modal.getByRole('button', { name: '选择位置并导出' }).click();
  await expect(modal.getByText('导出演示完成（未创建文件）')).toBeVisible();
  await expect(modal.getByText('result.pdf', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: /^关\s*闭$/ }).click();
  await expect(page.getByRole('textbox', { name: '成果编辑器' })).toHaveValue(
    '# 中文导出\n\n当前版本'
  );
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
});

test('creates and reopens typed spreadsheet, checklist, form, and tool Result adapters', async ({
  page,
}) => {
  await skipOnboarding(page);
  await page.getByRole('button', { name: '新建成果' }).click();
  let create = page.getByRole('dialog', { name: '新建成果' });
  await create.getByLabel('成果标题').fill('季度数据');
  await create.getByLabel('成果类型').click();
  await page.getByText('表格（CSV）', { exact: true }).last().click();
  await create.getByLabel('本地文件名').fill('季度数据.csv');
  await create.getByRole('button', { name: '创建并打开' }).click();

  await expect(page.getByLabel('表格预览')).toContainText('Column 1');
  await page.getByText('编辑', { exact: true }).click();
  await page.getByRole('textbox', { name: '成果编辑器' }).fill('月份,收入\n一月,100\n');
  await expect(page.getByText('有未保存修改')).toBeVisible();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 5000 });

  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: /成果$/ }).click();
  const spreadsheet = page.getByRole('article').filter({ hasText: '季度数据' });
  await expect(spreadsheet.getByText('表格', { exact: true })).toBeVisible();
  await spreadsheet.getByRole('button', { name: /继续处理/ }).click();
  await expect(page.getByLabel('表格预览')).toContainText('一月');

  await navigation.getByRole('button', { name: /成果$/ }).click();
  await page.getByRole('button', { name: '新建成果' }).click();
  create = page.getByRole('dialog', { name: '新建成果' });
  await create.getByLabel('成果标题').fill('发布清单');
  await create.getByLabel('成果类型').click();
  await page.getByText('清单', { exact: true }).last().click();
  await create.getByLabel('本地文件名').fill('发布清单.json');
  await create.getByRole('button', { name: '创建并打开' }).click();

  await expect(page.getByLabel('清单编辑器')).toContainText('发布清单');
  await page.getByText('编辑', { exact: true }).click();
  await page.getByRole('button', { name: /添加清单项/ }).click();
  await expect(page.locator('input[value="新清单项"]')).toBeVisible();
  await expect(page.getByText('有未保存修改')).toBeVisible();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 5000 });

  await navigation.getByRole('button', { name: /成果$/ }).click();
  await page.getByRole('button', { name: '新建成果' }).click();
  create = page.getByRole('dialog', { name: '新建成果' });
  await create.getByLabel('成果标题').fill('报名表单');
  await create.getByLabel('成果类型').click();
  await page.getByText('表单', { exact: true }).last().click();
  await create.getByLabel('本地文件名').fill('报名表单.json');
  await create.getByRole('button', { name: '创建并打开' }).click();

  await page.getByText('编辑', { exact: true }).click();
  const required = page.getByRole('checkbox', { name: '必填' });
  const requiredLabel = required.locator('xpath=ancestor::label');
  const checkboxBox = await requiredLabel.locator('.ant-checkbox').boundingBox();
  const labelBox = await requiredLabel.locator('.ant-checkbox-label').boundingBox();
  expect(checkboxBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(
    Math.abs(checkboxBox!.y + checkboxBox!.height / 2 - (labelBox!.y + labelBox!.height / 2))
  ).toBeLessThanOrEqual(2);

  await navigation.getByRole('button', { name: /成果$/ }).click();
  await page.getByRole('button', { name: '新建成果' }).click();
  create = page.getByRole('dialog', { name: '新建成果' });
  await create.getByLabel('成果标题').fill('安全小工具');
  await create.getByLabel('成果类型').click();
  await page.getByText('小工具', { exact: true }).last().click();
  await create.getByLabel('本地文件名').fill('安全小工具.json');
  await create.getByRole('button', { name: '创建并打开' }).click();

  await expect(page.getByLabel('工具配置编辑器')).toContainText('安全小工具');
  await page.getByText('编辑', { exact: true }).click();
  await page.getByLabel('工具配置编辑器').getByRole('textbox').nth(2).fill('仅保存受控配置');
  await expect(page.getByText('有未保存修改')).toBeVisible();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 5000 });

  await navigation.getByRole('button', { name: /成果$/ }).click();
  const tool = page.getByRole('article').filter({ hasText: '安全小工具' });
  await expect(tool.getByText('小工具', { exact: true })).toBeVisible();
  await tool.getByRole('button', { name: /继续处理/ }).click();
  await expect(page.getByLabel('工具配置编辑器')).toContainText('仅保存受控配置');
});

test('reviews and locally previews text, table, and image sources before any AI send', async ({
  page,
}) => {
  await skipOnboarding(page);
  await page.getByTestId('home-source-drop-zone').dispatchEvent('drop');
  const review = page.getByRole('dialog', { name: '确认读取范围' });
  await expect(review).toBeVisible();
  await expect(review.getByText('meeting-notes.md')).toBeVisible();
  await expect(review.getByText('research-report.docx')).toBeVisible();
  await expect(review.getByText('基础表格数据（只读）')).toBeVisible();
  await expect(review.getByText('原始视觉来源（只读）')).toBeVisible();
  await expect(review.getByText('隐藏文件、密钥或敏感路径不会加入导入批次')).toBeVisible();
  await expect(review.getByRole('checkbox', { name: /sales.xlsx/ })).toBeEnabled();
  await expect(review.getByRole('checkbox', { name: /whiteboard.png/ })).toBeEnabled();
  await expect(review.getByText(/确认前不建立授权/)).toBeVisible();

  await review.getByRole('button', { name: /取.*消/ }).click();
  await expect(review).toHaveCount(0);

  // Confirm a table in one batch, then an image in a later batch. The second
  // confirmation must append to the workspace sources instead of replacing them.
  await page.getByRole('button', { name: /选择资料/ }).click();
  const firstConfirmation = page.getByRole('dialog', { name: '确认读取范围' });
  await firstConfirmation.getByRole('checkbox', { name: /meeting-notes.md/ }).uncheck();
  await firstConfirmation.getByRole('checkbox', { name: /research-report.docx/ }).uncheck();
  await firstConfirmation.getByRole('checkbox', { name: /whiteboard.png/ }).uncheck();
  await firstConfirmation.getByRole('button', { name: '确认加入资料' }).click();
  await expect(firstConfirmation).toHaveCount(0);

  const tableSource = page.getByRole('article').filter({ hasText: 'sales.xlsx' });
  await expect(tableSource).toBeVisible();

  await page.getByRole('button', { name: /选择资料/ }).click();
  const secondConfirmation = page.getByRole('dialog', { name: '确认读取范围' });
  await secondConfirmation.getByRole('checkbox', { name: /meeting-notes.md/ }).uncheck();
  await secondConfirmation.getByRole('checkbox', { name: /research-report.docx/ }).uncheck();
  await secondConfirmation.getByRole('checkbox', { name: /sales.xlsx/ }).uncheck();
  await secondConfirmation.getByRole('button', { name: '确认加入资料' }).click();
  await expect(secondConfirmation).toHaveCount(0);

  const imageSource = page.getByRole('article').filter({ hasText: 'whiteboard.png' });
  await expect(tableSource).toBeVisible();
  await expect(imageSource).toBeVisible();
  await expect(page.getByText('仅保留在本机，尚未发送给 AI')).toBeVisible();
  await tableSource.getByRole('button', { name: '本地预览' }).click();
  await expect(page.getByRole('dialog', { name: /本地预览 · sales.xlsx/ })).toContainText(
    '表格仅在本机受控解析'
  );
  await expect(page.getByText('=2+2')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await imageSource.getByRole('button', { name: '本地预览' }).click();
  await expect(page.getByRole('dialog', { name: /本地预览 · whiteboard.png/ })).toContainText(
    '尚未发送给 AI'
  );
  await page.getByRole('button', { name: 'Close' }).click();

  await imageSource.getByRole('button', { name: '移除' }).click();
  await expect(page.getByText('取消读取 whiteboard.png？')).toBeVisible();
  await page.getByRole('button', { name: '暂不移除' }).click();
  await expect(imageSource).toBeVisible();

  await imageSource.getByRole('button', { name: '移除' }).click();
  await page.getByRole('button', { name: '取消授权' }).click();
  await expect(imageSource).toHaveCount(0);
  await expect(tableSource).toBeVisible();
});

test('remembers context packs, expands them for confirmation, and revokes references safely', async ({
  page,
}) => {
  await skipOnboarding(page);
  await page.getByRole('button', { name: /选择资料/ }).click();
  const confirmation = page.getByRole('dialog', { name: '确认读取范围' });
  await confirmation.getByRole('checkbox', { name: /meeting-notes.md/ }).uncheck();
  await confirmation.getByRole('checkbox', { name: /research-report.docx/ }).uncheck();
  await confirmation.getByRole('checkbox', { name: /whiteboard.png/ }).uncheck();
  await confirmation.getByRole('button', { name: '确认加入资料' }).click();

  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: /工作台/ }).click();
  await page.getByPlaceholder('描述你希望对当前文件做出的修改…').fill('仅本次分析销售表');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const oneTimeReview = page.getByRole('dialog', { name: '发送前确认上下文' });
  await oneTimeReview.getByRole('checkbox', { name: /sales.xlsx/ }).click();
  await oneTimeReview.getByRole('button', { name: '生成发送清单' }).click();
  await expect(oneTimeReview.getByText(/sales.xlsx/).last()).toBeVisible();
  await oneTimeReview.getByRole('button', { name: '确认并发送' }).click();
  await expect(oneTimeReview).toBeHidden();

  await page.getByPlaceholder('描述你希望对当前文件做出的修改…').fill('再次分析销售表');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(oneTimeReview).toBeHidden();
  await expect(page.getByText('再次分析销售表', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '修改发送清单' }).click();
  await expect(oneTimeReview).toBeVisible();
  await expect(oneTimeReview.getByRole('checkbox', { name: /sales.xlsx/ })).not.toBeChecked();
  await oneTimeReview.getByRole('button', { name: 'Close' }).click();

  await navigation.getByRole('button', { name: /设置$/ }).click();
  await page.getByRole('button', { name: '前往资料库管理资料与资料包' }).click();
  const manager = page.getByTestId('context-pack-settings');
  await expect(manager).toBeVisible();
  await manager.getByTestId('context-pack-name').fill('季度数据');
  await manager.getByTestId('context-pack-sources').click();
  await page.getByText('sales.xlsx', { exact: true }).last().click();
  await manager.getByTestId('create-context-pack').click();

  const pack = manager.getByTestId('context-pack-item').filter({ hasText: '季度数据' });
  await expect(pack).toContainText('sales.xlsx');

  await navigation.getByRole('button', { name: /工作台/ }).click();
  await page.getByRole('button', { name: '修改发送清单' }).click();
  const savedContext = page.getByRole('dialog', { name: '发送前确认上下文' });
  await savedContext.getByRole('checkbox', { name: /季度数据/ }).click();
  await savedContext.getByRole('button', { name: '保存上下文' }).click();
  await page.getByPlaceholder('描述你希望对当前文件做出的修改…').fill('总结季度数据');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const review = page.getByRole('dialog', { name: '发送前确认上下文' });
  await expect(review.getByRole('checkbox', { name: /季度数据/ })).toBeChecked();
  await review.getByRole('button', { name: '生成发送清单' }).click();
  await expect(review.getByText(/sales.xlsx/).last()).toBeVisible();
  await review.getByRole('button', { name: '确认并发送' }).click();
  await expect(review).toBeHidden();

  await page.getByPlaceholder('描述你希望对当前文件做出的修改…').fill('继续总结季度数据');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(review).toBeHidden();
  await expect(page.getByText('继续总结季度数据', { exact: true })).toBeVisible();

  await navigation.getByRole('button', { name: /设置$/ }).click();
  await page.getByRole('button', { name: '前往资料库管理资料与资料包' }).click();
  const rememberedPack = page.getByTestId('context-pack-item').filter({ hasText: '季度数据' });
  await rememberedPack.getByTestId('delete-context-pack').click();
  await page.getByRole('button', { name: '删除资料包' }).last().click();
  await expect(rememberedPack).toHaveCount(0);

  const source = page.getByTestId('authorized-source-item').filter({ hasText: 'sales.xlsx' });
  await expect(source).toBeVisible();

  await manager.getByTestId('context-pack-name').fill('待撤销数据');
  await manager.getByTestId('context-pack-sources').click();
  await page.getByText('sales.xlsx', { exact: true }).last().click();
  await manager.getByTestId('create-context-pack').click();
  await expect(
    page.getByTestId('context-pack-item').filter({ hasText: '待撤销数据' })
  ).toBeVisible();

  await source.getByTestId('revoke-authorized-source').click();
  await page.getByRole('button', { name: '取消授权' }).click();
  await expect(source).toHaveCount(0);
  await expect(page.getByTestId('context-pack-item').filter({ hasText: '待撤销数据' })).toHaveCount(
    0
  );
});
