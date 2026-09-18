import { expect, test, type Page, type TestInfo } from '@playwright/test';

type BetaLifecycleEvidence = {
  scenario: 'meeting_minutes' | 'document_summary';
  targetProfile: 'office_collaboration' | 'knowledge_research';
  elapsedMs: number;
  withinFirstResultBudget: boolean;
  taskCompleted: boolean;
  resultSaved: boolean;
  resultExported: boolean;
  exportFormatCategory: 'document';
};

const FIRST_EFFECTIVE_RESULT_BUDGET_MS = 90_000;
const lifecycleAttachmentNames = {
  meeting_minutes: 'beta-meeting_minutes-lifecycle.json',
  document_summary: 'beta-document_summary-lifecycle.json',
} as const;

const resetBrowserPreferences = async (page: Page, onboardingComplete: boolean) => {
  await page.addInitScript((complete) => {
    localStorage.clear();
    sessionStorage.clear();
    if (complete) localStorage.setItem('a2ui.onboarding-complete.v1', 'true');
  }, onboardingComplete);
  await page.goto('/');
};

const finishOnboarding = async (page: Page) => {
  const onboarding = page.getByRole('dialog', { name: '欢迎使用 A2UI 工作台' });
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole('button', { name: '跳过引导' }).click();
  await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible();
};

const openOrganizeTask = async (page: Page, template: '会议纪要' | '文档总结') => {
  await page.getByRole('button', { name: /整理一组资料/ }).click();
  const dialog = page.getByRole('dialog', { name: '创建本地成果草稿' });
  await dialog.getByRole('button', { name: new RegExp(template) }).click();
  return dialog;
};

const saveAndExportDocument = async (page: Page, content: string) => {
  await page.getByText('编辑', { exact: true }).click();
  await page.getByRole('textbox', { name: '成果编辑器' }).fill(content);
  await expect(page.getByText('有未保存修改')).toBeVisible();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /导出$/ }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出', exact: true });
  await expect(exportDialog.getByText(/Web Mock 仅演示/)).toBeVisible();
  await exportDialog.getByRole('button', { name: '选择位置并导出' }).click();
  await expect(exportDialog.getByText('导出演示完成（未创建文件）')).toBeVisible();
  await expect(exportDialog.getByText('result.pdf', { exact: true })).toBeVisible();
};

const attachLifecycleEvidence = async (info: TestInfo, evidence: BetaLifecycleEvidence) => {
  console.info('S4.7 Beta lifecycle evidence', JSON.stringify(evidence));
  await info.attach(lifecycleAttachmentNames[evidence.scenario], {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
};

test('office user completes, saves, and exports meeting minutes within the 90 second path', async ({
  page,
}, info) => {
  const startedAt = Date.now();
  await resetBrowserPreferences(page, false);
  await finishOnboarding(page);

  const task = await openOrganizeTask(page, '会议纪要');
  await task.getByLabel('请提供会议主题').fill('Beta 发布例会');
  await task.getByRole('button', { name: '创建结构草稿' }).click();
  await expect(task.getByText('本地结构草稿已创建')).toBeVisible();
  await task.getByRole('button', { name: /去工作台继续/ }).click();
  await expect(page.getByRole('heading', { name: '会议纪要 - Beta 发布例会' })).toBeVisible();

  await saveAndExportDocument(
    page,
    '# Beta 发布例会\n\n## 结论\n\n候选版本进入人工验收。\n\n## 行动项\n\n- 复核保存与导出。'
  );
  const elapsedMs = Date.now() - startedAt;
  const evidence: BetaLifecycleEvidence = {
    scenario: 'meeting_minutes',
    targetProfile: 'office_collaboration',
    elapsedMs,
    withinFirstResultBudget: elapsedMs <= FIRST_EFFECTIVE_RESULT_BUDGET_MS,
    taskCompleted: true,
    resultSaved: true,
    resultExported: true,
    exportFormatCategory: 'document',
  };
  expect(evidence.withinFirstResultBudget).toBe(true);
  await attachLifecycleEvidence(info, evidence);
});

test('knowledge user completes, saves, and exports the document-summary scenario', async ({
  page,
}, info) => {
  const startedAt = Date.now();
  await resetBrowserPreferences(page, true);
  const task = await openOrganizeTask(page, '文档总结');
  await task.getByLabel('请提供总结用途').click();
  await page.getByText('决策支持', { exact: true }).last().click();
  await task.getByRole('button', { name: '创建结构草稿' }).click();
  await expect(task.getByText('本地结构草稿已创建')).toBeVisible();
  await task.getByRole('button', { name: /去工作台继续/ }).click();
  await expect(page.getByRole('heading', { name: '文档总结' })).toBeVisible();

  await saveAndExportDocument(
    page,
    '# 文档总结\n\n## 关键观点\n\nBeta 证据必须能追溯到自动或人工检查。\n\n## 建议\n\n保留失败与恢复记录。'
  );
  const elapsedMs = Date.now() - startedAt;
  const evidence: BetaLifecycleEvidence = {
    scenario: 'document_summary',
    targetProfile: 'knowledge_research',
    elapsedMs,
    withinFirstResultBudget: elapsedMs <= FIRST_EFFECTIVE_RESULT_BUDGET_MS,
    taskCompleted: true,
    resultSaved: true,
    resultExported: true,
    exportFormatCategory: 'document',
  };
  expect(evidence.withinFirstResultBudget).toBe(true);
  await attachLifecycleEvidence(info, evidence);
});

test('four P0 templates and the completed table and structured-result entries are reachable', async ({
  page,
}) => {
  await resetBrowserPreferences(page, true);

  await page.getByRole('button', { name: /写一份文档/ }).click();
  let task = page.getByRole('dialog', { name: '创建本地成果草稿' });
  await expect(task.getByRole('button', { name: /周报/ })).toBeVisible();
  await task.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: /修改已有文件/ }).click();
  task = page.getByRole('dialog', { name: '创建本地成果草稿' });
  await expect(task.getByRole('button', { name: /简历优化/ })).toBeVisible();
  await task.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: /整理一组资料/ }).click();
  task = page.getByRole('dialog', { name: '创建本地成果草稿' });
  await expect(task.getByRole('button', { name: /会议纪要/ })).toBeVisible();
  await expect(task.getByRole('button', { name: /文档总结/ })).toBeVisible();
  await task.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: /分析表格或数据/ }).click();
  let create = page.getByRole('dialog', { name: '新建成果' });
  await expect(create.getByText('表格（CSV）', { exact: true })).toBeVisible();
  await create.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: /制作表单 \/ 清单 \/ 小工具/ }).click();
  create = page.getByRole('dialog', { name: '新建成果' });
  await expect(create.getByText('清单', { exact: true })).toBeVisible();
  await create.getByLabel('成果类型').click();
  await expect(page.getByText('清单', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('表单', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('小工具', { exact: true }).last()).toBeVisible();
});

test('a duplicate-name failure keeps the existing result and allows a safe retry', async ({
  page,
}) => {
  await resetBrowserPreferences(page, true);
  await page.getByRole('button', { name: '新建成果' }).click();
  let create = page.getByRole('dialog', { name: '新建成果' });
  let title = create.getByLabel('成果标题');
  let fileName = create.getByLabel('本地文件名');
  await title.fill('Beta 冲突基线');
  await title.press('Tab');
  await fileName.fill('beta-conflict.md');
  await expect(fileName).toHaveValue('beta-conflict.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await expect(page.getByRole('heading', { name: 'Beta 冲突基线' })).toBeVisible();

  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: /成果$/ }).click();
  await page.getByRole('button', { name: '新建成果' }).click();
  create = page.getByRole('dialog', { name: '新建成果' });
  title = create.getByLabel('成果标题');
  fileName = create.getByLabel('本地文件名');
  await title.fill('Beta 安全重试');
  await title.press('Tab');
  await fileName.fill('beta-conflict.md');
  await expect(fileName).toHaveValue('beta-conflict.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await expect(create.getByRole('alert')).toContainText('同名成果已存在');

  await fileName.fill('beta-retry.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await expect(page.getByRole('heading', { name: 'Beta 安全重试' })).toBeVisible();
  await navigation.getByRole('button', { name: /成果$/ }).click();
  await expect(page.getByText('Beta 冲突基线', { exact: true })).toBeVisible();
  await expect(page.getByText('Beta 安全重试', { exact: true })).toBeVisible();
});
