import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import path from 'node:path';

export async function verifyScenes(page, received, output) {
  const invoke = (command, args) =>
    page.evaluate(
      ([name, input]) => window.__TAURI_INTERNALS__.invoke(name, input),
      [command, args]
    );
  const nav = (name) =>
    page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name, exact: true })
      .click();
  const before = received.length;
  const tool = page.getByRole('region', { name: '场景工具工作台', exact: true });
  const created = [];
  const target = (await invoke('list_results')).find((r) => r.type === 'document');
  assert(target);
  const chooseDocument = async (dialog) => {
    await dialog.getByRole('combobox', { name: '关联对象' }).click();
    await page
      .getByText('文档 · ' + target.title, { exact: true })
      .last()
      .click();
  };
  for (const name of ['发布检查表', '采访提纲', '文档审核表', '任务清单', '信息收集表']) {
    await nav('模板');
    const builtins = page.getByRole('region', { name: '内置场景工具模板', exact: true });
    await expect(builtins.getByRole('heading', { name: '内置场景工具模板' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '我的模板', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '我的工具', exact: true })).toHaveCount(0);
    await expect(page.getByText(/选择模板即可在本机填写/)).toHaveCount(0);
    await expect(page.getByText('可独立使用，也可关联对象', { exact: true })).toHaveCount(0);
    await expect(builtins.getByRole('button', { name: '自定义 →', exact: true })).toHaveCount(5);
    await expect(page.getByRole('region', { name: '推荐模板', exact: true })).toHaveCount(1);
    await expect(builtins.getByText('可独立', { exact: true })).toHaveCount(5);
    await expect(builtins.getByText('可关联', { exact: true })).toHaveCount(0);
    const scopes = builtins.getByLabel('适用范围', { exact: true });
    await expect(scopes).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
      assert((await scopes.nth(index).locator('.ant-tag').count()) <= 2);
    }
    const cardBoxes = await builtins.locator('.ant-card').evaluateAll((cards) =>
      cards.map((card) => {
        const cardRect = card.getBoundingClientRect();
        const actionsRect = card
          .querySelector('[class*="templateActions"]')
          ?.getBoundingClientRect();
        return {
          height: cardRect.height,
          actionBottomGap: actionsRect ? cardRect.bottom - actionsRect.bottom : -1,
        };
      })
    );
    assert.equal(new Set(cardBoxes.map(({ height }) => Math.round(height))).size, 1);
    assert.equal(
      new Set(cardBoxes.map(({ actionBottomGap }) => Math.round(actionBottomGap))).size,
      1
    );
    if (output && name === '发布检查表') {
      await page.screenshot({ path: path.join(output, 'templates.png'), fullPage: true });
      await page.getByRole('heading', { name: '我的模板', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, 'templates-empty.png'), fullPage: true });
      await page.getByRole('button', { name: '前往我的工具', exact: true }).click();
      await expect(page.getByRole('tab', { name: '我的工具', exact: true })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      await nav('模板');
    }
    await builtins
      .locator('.ant-card')
      .filter({ hasText: name })
      .getByRole('button', { name: '使用模板', exact: true })
      .click();
    await expect(tool).toBeVisible();
    await expect(page.getByRole('tab', { name: '我的工具', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(tool.getByText('未关联对象 · 可独立使用', { exact: true })).toBeVisible();
    await tool.getByLabel('主题 / 对象', { exact: true }).fill('星河 420 尚未批准');
    if (name === '发布检查表') {
      await tool
        .getByLabel('发布负责人', { exact: true })
        .pressSequentially('Ada 420', { delay: 20 });
      await tool.getByLabel('标题与摘要', { exact: true }).check();
    }
    if (name === '采访提纲') {
      await tool.getByLabel('受访人', { exact: true }).fill('小林');
      await tool.getByLabel('关键事实 · 追问', { exact: true }).fill('预算是否已批准？');
    }
    if (name === '文档审核表')
      await tool.getByLabel('事实 · 审核记录', { exact: true }).fill('待核对金额 420 元');
    if (name === '任务清单') {
      await tool.getByLabel('准备资料', { exact: true }).check();
      await tool.getByLabel('准备资料 · 截止日期', { exact: true }).fill('2026-10-15');
    }
    if (name === '信息收集表') await tool.getByLabel('联系人', { exact: true }).fill('小林');
    await expect(tool.getByRole('status')).toContainText('已自动保存');
    assert(!(await invoke('list_results')).some((r) => r.title === name));
    const result = (await invoke('list_scene_tools')).find((r) => r.title === name);
    assert(result?.currentRevisionId);
    const document = await invoke('read_result_document', { resultId: result.id });
    assert(document.content.includes('星河 420 尚未批准'));
    assert(!document.content.includes('surfaceId'));
    if (name === '发布检查表') {
      assert(document.content.includes('[ ] 数据来源'));
      assert(document.content.includes('[x] 标题与摘要'));
      await tool.getByRole('button', { name: '更多工具操作', exact: true }).click();
      await page.getByRole('menuitem', { name: '保存为个人模板', exact: true }).click();
      const saveTemplate = page.getByRole('dialog', { name: '保存为个人模板', exact: true });
      await saveTemplate.getByLabel('模板名称').fill('M9 发布复用');
      await saveTemplate.getByRole('button', { name: '保存模板', exact: true }).click();
      await expect(saveTemplate).toBeHidden();
    }
    created.push(result);
  }
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await expect(tool).not.toBeVisible();
  await page.getByRole('tab', { name: '我的工具', exact: true }).click();
  await expect(tool.getByLabel('联系人', { exact: true })).toHaveValue('小林');
  const myToolsPanel = page.getByRole('region', { name: '我的工具', exact: true });
  await expect(myToolsPanel.getByRole('button', { name: '+ 新建工具', exact: true })).toBeVisible();
  await expect(myToolsPanel.getByRole('textbox', { name: '搜索工具', exact: true })).toBeVisible();
  await expect(myToolsPanel.getByRole('button', { name: '全部', exact: true })).toBeVisible();
  await expect(myToolsPanel.getByRole('button', { name: '已关联', exact: true })).toBeVisible();
  await expect(myToolsPanel.getByRole('button', { name: '未关联', exact: true })).toBeVisible();
  await expect(myToolsPanel.getByRole('button', { name: '已有成果', exact: true })).toBeVisible();
  await expect(myToolsPanel.getByRole('button', { name: '全部', exact: true })).toContainText('5');
  await expect(myToolsPanel.getByRole('button', { name: '已关联', exact: true })).toContainText(
    '0'
  );
  await expect(myToolsPanel.getByRole('button', { name: '未关联', exact: true })).toContainText(
    '5'
  );
  await expect(myToolsPanel.getByRole('button', { name: '已有成果', exact: true })).toContainText(
    '0'
  );
  const filterTops = await myToolsPanel
    .getByRole('group', { name: '筛选工具', exact: true })
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().top))
    );
  assert.equal(new Set(filterTops).size, 1);
  assert(
    (await myToolsPanel.evaluate((node) => node.parentElement.getBoundingClientRect().width)) >= 280
  );
  await expect(tool.getByText('基本信息', { exact: true })).toBeVisible();
  await expect(tool.getByText('收集内容', { exact: true })).toBeVisible();
  assert.equal(
    await tool
      .getByText('基本信息', { exact: true })
      .evaluate((node) => getComputedStyle(node).fontSize),
    '16px'
  );
  assert.equal(
    await tool
      .getByText('基本信息', { exact: true })
      .evaluate(
        (node) => getComputedStyle(node.closest('[data-a2ui-node^="scene-group-"]')).paddingTop
      ),
    '24px'
  );
  assert.equal(
    await tool.getByRole('status').evaluate((node) => getComputedStyle(node).fontSize),
    '12px'
  );
  const activeRow = myToolsPanel
    .getByRole('button', { name: '信息收集表', exact: true })
    .locator('..');
  assert.equal(
    await activeRow.evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgb(255, 241, 231)'
  );
  assert.equal(
    await activeRow.evaluate((node) => getComputedStyle(node, '::before').backgroundColor),
    'rgb(212, 90, 24)'
  );
  const rowMenu = myToolsPanel.getByRole('button', {
    name: '工具操作：信息收集表',
    exact: true,
  });
  assert.equal(await rowMenu.evaluate((node) => getComputedStyle(node).opacity), '0');
  await activeRow.hover();
  await expect(rowMenu).toHaveCSS('opacity', '1');
  const toolSearch = myToolsPanel.getByRole('textbox', { name: '搜索工具', exact: true });
  await toolSearch.fill('信息收集表');
  await expect(myToolsPanel.getByRole('button', { name: '信息收集表', exact: true })).toHaveCount(
    1
  );
  await toolSearch.fill('');
  if (output) await page.screenshot({ path: path.join(output, 'my-tools.png'), fullPage: true });
  // Only an explicit click publishes; later autosaves must leave its snapshot alone.
  await tool.getByRole('button', { name: '保存为成果', exact: true }).click();
  const syncedButton = tool.getByText('已同步', { exact: true });
  await expect(syncedButton).toBeVisible();
  assert.equal(
    await syncedButton.evaluate((node) => getComputedStyle(node).color),
    'rgb(35, 120, 4)'
  );
  await expect(
    myToolsPanel
      .getByRole('button', { name: '信息收集表', exact: true })
      .locator('..')
      .getByText(/成果 Rev 1/)
  ).toBeVisible();
  if (output) await page.screenshot({ path: path.join(output, 'tool-synced.png'), fullPage: true });
  const publication = (await invoke('read_scene_tool', { resultId: created.at(-1).id }))
    .publication;
  const snapshotBefore = await invoke('read_result_document', { resultId: publication.resultId });
  await tool.getByLabel('主题 / 对象', { exact: true }).fill('仅工具的新填写');
  await expect(tool.getByRole('status')).toContainText('已自动保存');
  await expect(tool.getByText('● 工具有更新，成果未同步', { exact: true })).toBeVisible();
  await expect(
    myToolsPanel
      .getByRole('button', { name: '信息收集表', exact: true })
      .locator('..')
      .getByText(/成果待更新/)
  ).toBeVisible();
  if (output)
    await page.screenshot({ path: path.join(output, 'tool-update-needed.png'), fullPage: true });
  assert.equal(
    (await invoke('read_result_document', { resultId: publication.resultId })).content,
    snapshotBefore.content
  );
  await tool.getByRole('button', { name: '更新成果', exact: true }).click();
  await expect(tool.getByText('已同步', { exact: true })).toBeVisible();
  await expect
    .poll(
      async () => (await invoke('read_result_document', { resultId: publication.resultId })).content
    )
    .toContain('仅工具的新填写');
  assert.equal((await invoke('list_results')).filter((r) => r.title === '信息收集表').length, 1);
  // A saved result opens as a snapshot, never as the live editing tool.
  await nav('成果');
  await page
    .getByRole('article')
    .filter({ hasText: '信息收集表' })
    .getByRole('button', { name: /继续处理/ })
    .click();
  await expect(tool).not.toBeVisible();
  await expect(page.getByText(/这是手动保存的成果快照/)).toBeVisible();
  // The optional "current document" choice uses the file-side document, not the tool.
  await nav('成果');
  await page
    .getByRole('article')
    .filter({ hasText: target.title })
    .getByRole('button', { name: /继续处理/ })
    .click();
  await expect(page.getByText(target.title, { exact: true }).first()).toBeVisible();
  await nav('模板');
  await page
    .getByRole('region', { name: '内置场景工具模板', exact: true })
    .locator('.ant-card')
    .filter({ hasText: '文档审核表' })
    .getByRole('button', { name: '自定义 →', exact: true })
    .click();
  const currentDialog = page.getByRole('dialog', { name: '自定义文档审核表', exact: true });
  await currentDialog.getByRole('radio', { name: '当前打开的文档', exact: true }).check();
  await currentDialog.getByLabel('工具名称').fill('当前文档审核验证');
  await currentDialog.getByRole('button', { name: '创建工具', exact: true }).click();
  await expect(tool).toBeVisible();
  const currentTool = (await invoke('list_scene_tools')).find(
    (r) => r.title === '当前文档审核验证'
  );
  assert.equal(currentTool.bindingTitle, target.title);
  const currentBinding = await invoke('read_tool_binding', { toolResultId: currentTool.id });
  assert.equal(currentBinding.link.binding.target.resultId, target.id);
  await nav('工作台');
  await page.getByRole('tab', { name: '我的工具', exact: true }).click();
  await page
    .getByRole('region', { name: '我的工具', exact: true })
    .getByRole('button', { name: '发布检查表', exact: true })
    .click();
  await tool.getByRole('button', { name: '关联对象', exact: true }).click();
  const bindingDialog = page.getByRole('dialog');
  await chooseDocument(bindingDialog);
  await bindingDialog.getByRole('button', { name: '确认关联', exact: true }).click();
  await tool.getByRole('button', { name: /关联详情与核对依据/ }).click();
  await expect(tool.getByText(/关联时版本：.*\d{4}.*保存/)).toBeVisible();
  const link = await invoke('read_tool_binding', { toolResultId: created[0].id });
  assert.equal(link.bindingPolicy, 'optional');
  assert.equal(link.link.binding.type, 'document');
  assert.equal(link.link.boundRevisionId, link.currentRevisionId);
  assert(link.boundRevision?.savedAt);
  const reviewed = await invoke('confirm_tool_binding', {
    input: {
      toolResultId: created[0].id,
      version: link.link.version,
      targetHash: link.currentHash,
      targetRevisionId: link.currentRevisionId,
      toolStateHash: link.toolStateHash,
    },
  });
  assert.equal(reviewed.status, 'current');
  await expect(tool.getByText(/关联：.+ · 正常/)).toBeVisible({ timeout: 7000 });
  await tool.getByRole('button', { name: /更\s*换/, exact: true }).click();
  const unlinkDialog = page.getByRole('dialog', { name: '选择关联对象', exact: true });
  await unlinkDialog.getByRole('combobox', { name: '关联对象', exact: true }).click();
  await page.getByText('独立使用（不关联对象）', { exact: true }).last().click();
  await unlinkDialog.getByRole('button', { name: '确认关联', exact: true }).click();
  await expect(tool.getByText('未关联对象 · 可独立使用', { exact: true })).toBeVisible();
  await expect(tool.getByLabel('发布负责人', { exact: true })).toHaveValue('Ada 420');
  const other = await invoke('read_scene_tool', { resultId: created.at(-1).id });
  const bound = await invoke('set_tool_binding', {
    input: {
      toolResultId: other.result.id,
      binding: { type: 'result', targetId: publication.resultId },
      expectedVersion: null,
    },
  });
  assert.equal(bound.context.scope, 'result_content');
  assert.equal(bound.context.modelAccess, false);
  await nav('模板');
  const personal = page.getByRole('region', { name: '我的工具模板' });
  const card = personal.locator('.ant-card').filter({ hasText: 'M9 发布复用' });
  await expect(card.getByText('我的模板', { exact: true })).toBeVisible();
  await expect(card.getByText(/基于：\s*发布检查表/)).toBeVisible();
  if (output) {
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'personal-template.png'), fullPage: true });
  }
  await card.getByRole('button', { name: '使用模板' }).click();
  const clone = page.getByRole('dialog', { name: '使用个人模板', exact: true });
  await clone.getByRole('button', { name: '创建工具', exact: true }).click();
  await expect(tool.getByLabel('主题 / 对象', { exact: true })).toHaveValue('');
  await expect(tool.getByLabel('发布负责人', { exact: true })).toHaveValue('');
  await expect(tool.getByLabel('标题与摘要', { exact: true })).not.toBeChecked();
  // Navigation must not cancel pending autosave or wipe the current entries.
  await tool.getByLabel('主题 / 对象', { exact: true }).fill('跨页面保留');
  await nav('首页');
  await nav('工作台');
  await expect(tool.getByLabel('主题 / 对象', { exact: true })).toHaveValue('跨页面保留');
  await expect(tool.getByRole('status')).toContainText('已自动保存');
  await page.reload();
  await nav('工作台');
  await page.getByRole('tab', { name: '我的工具', exact: true }).click();
  await page
    .getByRole('region', { name: '我的工具', exact: true })
    .getByRole('button', { name: '信息收集表', exact: true })
    .click();
  await expect(tool.getByLabel('联系人', { exact: true })).toHaveValue('小林');
  const current = await invoke('read_scene_tool', { resultId: created.at(-1).id });
  await invoke('save_scene_tool', {
    input: {
      resultId: current.result.id,
      baseHash: current.stateHash,
      data: { subject: '其他页面的新值' },
    },
  });
  await tool.getByLabel('主题 / 对象', { exact: true }).fill('旧页面保留输入');
  await expect(tool.getByText(/内容已在其他页面更新/)).toBeVisible();
  assert.equal(
    (await invoke('read_scene_tool', { resultId: current.result.id })).surface.data.subject,
    '其他页面的新值'
  );
  await expect(tool.getByLabel('主题 / 对象', { exact: true })).toHaveValue('旧页面保留输入');
  await tool.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.getByRole('button', { name: /确\s*定|OK/, exact: true }).click();
  await expect(tool.getByLabel('主题 / 对象', { exact: true })).toHaveValue('其他页面的新值');
  await tool.getByRole('button', { name: /^导\s*出$/ }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出', exact: true });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole('button', { name: /关\s*闭/, exact: true }).click();
  const myTools = page.getByRole('region', { name: '我的工具', exact: true });
  const informationMenu = myTools.getByRole('button', {
    name: '工具操作：信息收集表',
    exact: true,
  });
  await informationMenu.locator('..').hover();
  await informationMenu.click();
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), [
    '保存为个人模板',
    '重命名',
    '更换关联对象',
    '删除工具',
  ]);
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const renameDialog = page.getByRole('dialog', { name: '重命名工具', exact: true });
  await renameDialog.getByLabel('工具名称', { exact: true }).fill('小林访谈资料');
  await renameDialog.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(renameDialog).toBeHidden();
  await expect(tool.getByRole('heading', { name: '小林访谈资料', exact: true })).toBeVisible();
  await expect(myTools.getByRole('button', { name: '小林访谈资料', exact: true })).toBeVisible();
  const renamedMenu = myTools.getByRole('button', {
    name: '工具操作：小林访谈资料',
    exact: true,
  });
  await renamedMenu.locator('..').hover();
  await renamedMenu.click();
  await page.getByRole('menuitem', { name: '删除工具', exact: true }).click();
  const deleteConfirm = page.getByRole('dialog', { name: '删除工具“小林访谈资料”？' });
  await deleteConfirm.getByRole('button', { name: /删\s*除/, exact: true }).click();
  await expect(myTools.getByRole('button', { name: '小林访谈资料', exact: true })).toHaveCount(0);
  assert((await invoke('list_results')).some((r) => r.id === publication.resultId));
  assert.equal(received.length, before);
  return [
    'scene_templates_creation_only',
    'scene_template_recommendation_and_scope',
    'scene_template_fixed_grid_and_tag_limit',
    'scene_template_empty_state_navigation',
    'scene_personal_template_identity',
    'scene_simple_templates_direct_open',
    'scene_workbench_file_tool_tabs',
    'scene_current_document_creation',
    'scene_manual_publication_only',
    'scene_snapshot_isolation',
    'scene_explicit_update_same_result',
    'scene_snapshot_readonly_route',
    'scene_my_tools_reopen',
    'scene_five_templates',
    'scene_readable_revision_labels',
    'scene_all_templates_standalone',
    'scene_optional_binding_and_unlink',
    'scene_personal_template_standalone',
    'scene_result_binding_without_file',
    'scene_review_checkpoint',
    'scene_binding_context_separation',
    'scene_real_inputs',
    'scene_atomic_snapshot',
    'scene_pending_items_export',
    'scene_template_values_cleared',
    'scene_navigation_autosave',
    'scene_webview_reload',
    'scene_conflict_keeps_input',
    'scene_export_entry',
    'scene_rename_and_distinguishable_list',
    'scene_tool_search_and_filters',
    'scene_tool_compact_sidebar_counts',
    'scene_tool_binding_and_result_statuses',
    'scene_tool_quiet_autosave_status',
    'scene_tool_light_selection_and_hover_menu',
    'scene_tool_form_sections',
    'scene_delete_preserves_published_result',
    'scene_zero_model_requests',
  ];
}
