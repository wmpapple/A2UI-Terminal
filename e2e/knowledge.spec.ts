import { expect, test } from '@playwright/test';

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
  await manager.getByTestId('context-pack-name').fill('宣传资料');
  await manager.getByRole('combobox', { name: '选择个人资料' }).click();
  await page.getByText('pack-evidence.txt', { exact: true }).last().click();
  await manager.getByTestId('context-pack-name').click();
  await manager.getByTestId('create-context-pack').click();
  await expect(manager.getByTestId('context-pack-item')).toContainText(
    'pack-evidence.txt (个人资料)'
  );
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('button', { name: /工作台$/ }).click();
  await page.getByPlaceholder('描述你希望对当前文件做出的修改…').fill('根据宣传资料总结预算');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '发送前确认上下文' });
  await dialog.getByRole('checkbox', { name: /宣传资料/ }).check();
  await dialog.getByRole('button', { name: '生成发送清单' }).click();
  await expect(dialog.getByText(/pack-evidence.txt · 24 chars/)).toBeVisible();
  await dialog.getByRole('button', { name: '确认并发送' }).click();
  await expect(dialog).toBeHidden();
  await nav.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByTestId('context-pack-settings')).toHaveCount(0);
  await page.getByRole('button', { name: '前往资料库管理资料与资料包' }).click();
  await expect(page.getByRole('tab', { name: '资料包', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await manager.getByTestId('delete-context-pack').click();
  await page.getByRole('button', { name: '删除资料包', exact: true }).last().click();
  await expect(manager.getByTestId('context-pack-item')).toHaveCount(0);
  await page.getByRole('tab', { name: '全部资料', exact: true }).click();
  await page.getByRole('button', { name: 'pack-evidence.txt', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Pack evidence budget 420');
});

test('personal library confirms import, persists, edits metadata, searches and deletes a copy', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/#/knowledge');
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
  await page.reload();
  await page.getByRole('button', { name: 'library-note.md', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Knowledge evidence 420');
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
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '资料库', exact: true })
    .click();
  await page.getByRole('button', { name: /删\s*除/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('button', { name: 'Launch reference', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Launch reference', exact: true })).toHaveCount(0);
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
  await page.getByPlaceholder('描述你希望对当前文件做出的修改…').fill('总结这份个人资料');
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
