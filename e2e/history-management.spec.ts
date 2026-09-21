import { expect, test } from '@playwright/test';

test('pins results before recent items and keeps the state when returning to the list', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/#/results');
  const nav = page.getByRole('navigation', { name: '主导航' });
  const cards = page.getByRole('article');
  await expect(cards.first()).toBeVisible();
  const olderTitle = await cards.first().locator('strong').innerText();
  await page.getByRole('button', { name: /新建成果/ }).click();
  const create = page.getByRole('dialog', { name: '新建成果', exact: true });
  await create.getByLabel('成果标题').fill('置顶操作验收');
  await create.getByLabel('本地文件名').fill('pin-check.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await expect(create).toHaveCount(0);
  await nav.getByRole('button', { name: '成果', exact: true }).click();
  await expect(cards.first().locator('strong')).toHaveText('置顶操作验收');

  await page.getByRole('button', { name: `置顶成果: ${olderTitle}`, exact: true }).click();
  await expect(cards.first().locator('strong')).toHaveText(olderTitle);
  await expect(
    cards.first().getByRole('button', { name: `取消置顶: ${olderTitle}`, exact: true })
  ).toHaveAttribute('aria-pressed', 'true');

  await nav.getByRole('button', { name: '模板', exact: true }).click();
  await nav.getByRole('button', { name: '成果', exact: true }).click();
  await expect(cards.first().locator('strong')).toHaveText(olderTitle);
  await page.getByRole('button', { name: `取消置顶: ${olderTitle}`, exact: true }).click();
  await expect(cards.first().locator('strong')).toHaveText('置顶操作验收');
  await expect(
    page.getByRole('button', { name: `置顶成果: ${olderTitle}`, exact: true })
  ).toHaveAttribute('aria-pressed', 'false');
});

test('result deletion and chat history controls work from their lists', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('button', { name: '成果', exact: true }).click();
  const cards = page.getByRole('article');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  await cards
    .first()
    .getByRole('button', { name: /^删除成果:/ })
    .click();
  await page
    .getByRole('dialog', { name: '删除成果' })
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await expect(cards).toHaveCount(count);
  await cards
    .first()
    .getByRole('button', { name: /^删除成果:/ })
    .click();
  await page
    .getByRole('dialog', { name: '删除成果' })
    .getByRole('button', { name: '确认删除', exact: true })
    .click();
  await expect(cards).toHaveCount(count - 1);
  await nav.getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '历史对话', exact: true });
  await drawer.getByRole('textbox', { name: '查找标题或对话内容' }).fill('no-match-92837');
  await expect(drawer.getByText('没有找到相关对话')).toBeVisible();
  await drawer.getByRole('textbox').fill('');
  await drawer
    .getByRole('button', { name: /^置顶对话:/ })
    .first()
    .click();
  await expect(drawer.getByRole('region', { name: '置顶对话' })).toBeVisible();
  await drawer
    .getByRole('button', { name: /^取消置顶:/ })
    .first()
    .click();
  await expect(drawer.getByRole('region', { name: '置顶对话' })).toHaveCount(0);
  await drawer
    .getByRole('button', { name: /^删除对话:/ })
    .first()
    .click();
  await page
    .getByRole('dialog', { name: '删除对话', exact: true })
    .getByRole('button', { name: '确认删除', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '删除对话', exact: true })).toHaveCount(0);
});
