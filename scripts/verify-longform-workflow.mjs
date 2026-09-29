import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function verifyLongform(page, received) {
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByRole('button', { name: '长文项目', exact: true }).click();
  await page.getByRole('button', { name: '创建写作空间', exact: true }).click();
  const saveProject = page.getByRole('button', { name: '保存项目并编辑大纲' });
  await expect(saveProject).not.toBeInViewport();
  await page.getByRole('heading', { name: '我的长文项目', exact: true }).hover();
  await page.mouse.wheel(0, 1600);
  await expect(saveProject).toBeInViewport();
  await page.mouse.wheel(0, -1600);
  await expect(page.getByRole('textbox', { name: '项目标题', exact: true })).toBeInViewport();
  await page.getByRole('textbox', { name: '项目标题', exact: true }).fill('M6 桌面长文');
  await page.getByRole('textbox', { name: '写作目标', exact: true }).fill('两章报告，保留事实');
  await page
    .getByRole('textbox', { name: '关键事实与未决事项', exact: true })
    .fill('预算 420 元，尚未批准');
  await page.getByRole('button', { name: '保存项目并编辑大纲' }).click();
  await page.getByRole('button', { name: 'AI 生成大纲', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认本次长文发送范围' });
  await expect(confirmation).toBeVisible();
  const before = received.length;
  await page.waitForTimeout(150);
  assert.equal(received.length, before, 'Planning must not contact the provider');
  await confirmation.getByRole('button', { name: '确认并开始本次生成' }).click();
  await expect(page.getByRole('textbox', { name: '章节标题 1', exact: true })).toHaveValue(
    '预算现状'
  );
  await page.getByRole('button', { name: '确认大纲，进入章节' }).click();
  await expect(page.getByRole('button', { name: '合成为最终成果' })).toBeDisabled();
  await page.getByRole('button', { name: '规划本章生成' }).click();
  await confirmation.getByRole('button', { name: '确认并开始本次生成' }).click();
  const content = page.getByRole('textbox', { name: '章节正文', exact: true });
  await expect(content).toContainText('420');
  const first = '预算 420 元，尚未批准。M6 人工修改保留。';
  await content.fill(first);
  await page
    .getByRole('textbox', { name: '本章事实摘要', exact: true })
    .fill('预算 420 元，尚未批准');
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByRole('button', { name: '长文项目', exact: true }).click();
  await expect(content).toHaveValue(first);
  await page.reload();
  await page.getByRole('button', { name: 'M6 桌面长文', exact: true }).click();
  await page.getByRole('tab', { name: '3. 章节与成果', exact: true }).click();
  await expect(content).toHaveValue(first);
  await page.getByRole('button', { name: '接受本章正文与摘要' }).click();
  await page.getByRole('combobox', { name: '当前章节' }).click();
  await page.getByText('2. 后续行动 · 待审阅', { exact: true }).click();
  await page.getByRole('button', { name: '规划本章生成' }).click();
  await confirmation.getByRole('button', { name: '确认并开始本次生成' }).click();
  await expect(content).toContainText('420');
  await page
    .getByRole('textbox', { name: '本章事实摘要', exact: true })
    .fill('审批完成之前保留待办');
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '接受本章正文与摘要' }).click();
  assert.match(received.at(-1).payload.messages[1].content, /预算 420 元，尚未批准/);
  assert(!received.at(-1).payload.messages[1].content.includes('M6 人工修改保留'));
  await page.getByRole('button', { name: '合成为最终成果' }).click();
  await expect(page.getByRole('region', { name: '成果工作区' })).toBeVisible();
  await expect(page.getByText(first, { exact: true })).toBeVisible();
  assert.equal(received.length - before, 3, 'Outline and exactly two chapters');
  assert(received.every((r) => !r.credentialSent));
  return [
    'longform_mouse_scroll',
    'longform_outline_confirmation',
    'longform_serial_chapters',
    'longform_consent_no_early_request',
    'longform_draft_navigation_reload',
    'longform_summary_context',
    'longform_result_assembly',
  ];
}
