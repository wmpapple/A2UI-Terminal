import { expect, test } from '@playwright/test';

test('keeps library controls usable at a narrow viewport', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/knowledge');
  const library = page.getByRole('region', { name: '资料库', exact: true });
  await expect(library.getByRole('heading', { name: '资料库' })).toBeVisible();
  await expect(library.getByText('还没有资料')).toBeVisible();
  expect((await library.getByTestId('knowledge-empty').boundingBox())?.height ?? 0).toBeLessThanOrEqual(220);
  const bounds = await library.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  await page.getByRole('tab', { name: '资料包' }).click();
  await expect(library.getByRole('tab', { name: '资料包' })).toBeVisible();
  await page.getByRole('button', { name: '选择工作区' }).click();
  expect((await library.getByTestId('pack-empty').boundingBox())?.height ?? 0).toBeLessThanOrEqual(190);
  await page.getByRole('button', { name: '新建资料包' }).click();
  await page.getByRole('button', { name: '添加个人资料' }).click();
  const picker = page.getByRole('group', { name: '添加个人资料' });
  await expect(picker).toBeVisible();
  const pickerBounds = await picker.boundingBox();
  expect(pickerBounds).not.toBeNull();
  expect(pickerBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((pickerBounds?.x ?? 0) + (pickerBounds?.width ?? 0)).toBeLessThanOrEqual(390);
});

test('using a library source prepares context but still requires send review', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/#/knowledge');
  await page.getByRole('tab', { name: '资料包' }).click();
  await page.getByRole('button', { name: '选择工作区' }).click();
  await page.getByRole('tab', { name: '我的资料' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'task-source.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Task source evidence'),
  });
  await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click();
  await page.getByRole('button', { name: 'task-source.txt', exact: true }).click();
  await page.getByRole('dialog', { name: '资料详情' }).getByRole('button', { name: '用于当前任务' }).click();
  await expect(page).toHaveURL(/#\/workbench$/);
  await expect(page.getByRole('dialog', { name: '发送前确认上下文' })).toHaveCount(0);
  await page.getByPlaceholder('描述你希望对当前文档做出的修改…').fill('总结资料');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const review = page.getByRole('dialog', { name: '发送前确认上下文' });
  await expect(review).toBeVisible();
  await expect(
    review.locator('.ant-select-selection-item').filter({ hasText: 'task-source.txt' })
  ).toBeVisible();
  await review.getByRole('button', { name: '生成发送清单' }).click();
  await expect(review.getByText(/task-source.txt · \d+ chars/)).toBeVisible();
});

test('unified library groups personal sources, expands a pack and preserves sources on pack deletion', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('a2ui.onboarding-complete.v1', 'true');
    localStorage.setItem('a2ui.experience-mode.v1', 'professional');
  });
  await page.goto('/#/knowledge');
  await expect(page.getByRole('heading', { name: '资料库', exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'pack-evidence.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Pack evidence budget 420'),
  });
  await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click();
  await expect(page.getByRole('button', { name: 'pack-evidence.txt', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '资料包', exact: true }).click();
  await page.getByRole('button', { name: '选择工作区', exact: true }).click();
  const manager = page.getByTestId('context-pack-settings');
  await manager.getByRole('button', { name: '新建资料包' }).click();
  const createDrawer = page.getByRole('dialog', { name: '新建资料包' });
  await createDrawer.getByTestId('context-pack-name').fill('宣传资料');
  await createDrawer.getByRole('button', { name: '添加个人资料' }).click();
  const picker = page.getByRole('group', { name: '添加个人资料' });
  await picker.getByRole('checkbox', { name: 'pack-evidence.txt' }).check();
  await expect(createDrawer.getByText('已选择 1 项')).toBeVisible();
  await picker.getByRole('button', { name: '完成' }).click();
  await createDrawer.getByTestId('create-context-pack').click();
  await expect(manager.getByTestId('context-pack-item')).toContainText('pack-evidence.txt');
  await manager.getByRole('button', { name: '打开' }).click();
  await expect(manager.getByTestId('context-pack-item')).toContainText('个人资料');
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('button', { name: /工作台$/ }).click();
  await page.getByPlaceholder('描述你希望对当前文档做出的修改…').fill('根据宣传资料总结预算');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '发送前确认上下文' });
  await dialog.getByRole('checkbox', { name: /宣传资料/ }).check();
  await dialog.getByRole('button', { name: '生成发送清单' }).click();
  await expect(dialog.getByText(/pack-evidence.txt · 24 chars/)).toBeVisible();
  await dialog.getByRole('button', { name: '确认并发送' }).click();
  await expect(dialog).toBeHidden();
  await nav.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByTestId('context-pack-settings')).toHaveCount(0);
  await page.getByRole('button', { name: '隐私与数据' }).click();
  await page.getByRole('button', { name: '前往资料库管理资料与资料包' }).click();
  await expect(page.getByRole('tab', { name: '资料包', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await manager.getByTestId('pack-actions').click();
  await page.getByRole('menuitem', { name: '删除资料包' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除资料包', exact: true }).click();
  await expect(manager.getByTestId('context-pack-item')).toHaveCount(0);
  await page.getByRole('tab', { name: '我的资料', exact: true }).click();
  await page.getByRole('button', { name: 'pack-evidence.txt', exact: true }).click();
  await page.getByRole('dialog', { name: '资料详情' }).getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '资料详情' })).toContainText('Pack evidence budget 420');
});

test('personal library confirms import, persists, edits metadata, searches and deletes a copy', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/#/knowledge');
  const libraryRegion = page.getByRole('region', { name: '个人资料库' });
  const searchWidth = (await libraryRegion.getByLabel('搜索资料库').boundingBox())?.width ?? 0;
  const regionWidth = (await libraryRegion.boundingBox())?.width ?? 0;
  expect(searchWidth).toBeGreaterThan(0);
  expect(searchWidth).toBeLessThan(regionWidth * 0.75);
  const file = {
    name: 'library-note.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Launch\nKnowledge evidence 420 中文🙂'),
  };
  await page.locator('input[type=file]').setInputFiles(file);
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('library-note.md');
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await expect(page.getByRole('button', { name: 'library-note.md', exact: true })).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click();
  await expect(page.getByRole('button', { name: 'library-note.md', exact: true })).toBeVisible();
  const sourceRow = page.getByRole('region', { name: '个人资料库' }).getByRole('listitem').filter({ hasText: 'library-note.md' });
  await expect(sourceRow).toContainText('Markdown');
  await expect(sourceRow).toContainText('可检索');
  expect((await sourceRow.boundingBox())?.height ?? 0).toBeLessThan(120);
  await page.reload();
  await page.getByRole('button', { name: 'library-note.md', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '资料详情' });
  await expect(dialog).toContainText('Markdown · 个人资料库');
  await expect(dialog.getByRole('region', { name: '状态信息' })).toContainText('已索引');
  await expect(dialog.getByRole('region', { name: '标签信息' })).toContainText('暂无标签');
  await dialog.getByRole('button', { name: '预览', exact: true }).click();
  await expect(dialog).toContainText('Knowledge evidence 420');
  await dialog.getByRole('button', { name: '编辑信息' }).click();
  await dialog.getByRole('textbox', { name: '资料名称' }).fill('Launch reference');
  await dialog.getByRole('button', { name: '保存名称和标签' }).click();
  await expect(page.getByRole('button', { name: 'Launch reference', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  await page
    .getByPlaceholder(
      '\u8f93\u5165\u6210\u679c\u6807\u9898\u3001\u6b63\u6587\u5173\u952e\u8bcd\u6216\u8d44\u6599\u540d\u79f0'
    )
    .fill('420');
  await expect(page.getByText('Launch reference', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览资料', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Knowledge evidence 420');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '资料库', exact: true })
    .click();
  await page.getByRole('button', { name: '资料操作：Launch reference' }).click();
  await page.getByRole('menuitem', { name: '从资料库删除' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('button', { name: 'Launch reference', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Launch reference', exact: true })).toHaveCount(0);
});

test('source details fit a narrow viewport and keep deletion behind confirmation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/knowledge');
  await page.locator('input[type=file]').setInputFiles({
    name: 'source-detail.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Local source detail'),
  });
  await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click();
  await page.getByRole('button', { name: 'source-detail.txt', exact: true }).click();
  const details = page.getByRole('dialog', { name: '资料详情' });
  await expect(details).toBeVisible();
  await expect.poll(async () => (await details.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => {
    const box = await details.boundingBox();
    return box ? box.x + box.width : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(390);
  const bounds = await details.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(details.getByRole('region', { name: '基本信息' })).toContainText('source-detail.txt');
  await details.getByRole('button', { name: '更多资料操作' }).click();
  await details.getByRole('menuitem', { name: '从资料库删除' }).click();
  await expect(page.getByText('删除资料副本？')).toBeVisible();
  await expect(page.getByRole('button', { name: 'source-detail.txt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /取\s*消/ }).click();
  await expect(page.getByRole('button', { name: 'source-detail.txt', exact: true })).toBeVisible();
});

test('personal sources require an explicit manifest and are not remembered for the next send', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('a2ui.onboarding-complete.v1', 'true');
    localStorage.setItem('a2ui.experience-mode.v1', 'professional');
  });
  await page.goto('/#/knowledge');
  await page.locator('input[type=file]').setInputFiles({
    name: 'manifest-source.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Approved evidence only 420'),
  });
  await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click();
  await expect(
    page.getByRole('button', { name: 'manifest-source.txt', exact: true })
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /工作台$/ })
    .click();
  await page.getByPlaceholder('描述你希望对当前文档做出的修改…').fill('总结这份个人资料');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '发送前确认上下文' });
  await dialog.getByRole('combobox', { name: '选择个人资料' }).click();
  await page.getByText('manifest-source.txt', { exact: true }).last().click();
  await dialog.getByRole('button', { name: '生成发送清单' }).click();
  await expect(dialog.getByText('manifest-source.txt', { exact: true }).last()).toBeVisible();
  await dialog.getByRole('button', { name: '确认并发送' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '修改发送清单' }).click();
  await expect(dialog.getByRole('combobox', { name: '选择个人资料' })).toHaveValue('');
  await expect(
    dialog.locator('.ant-select-selection-item').filter({ hasText: 'manifest-source.txt' })
  ).toHaveCount(0);
});
