import { expect, test } from '@playwright/test';

test('settings categories stay navigable without page overflow on desktop and mobile', async ({
  page,
}) => {
  await page.goto('/');
  const skip = page.getByRole('button', { name: '跳过引导' });
  if (await skip.isVisible()) await skip.click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /设置$/ })
    .click();

  const categories = page.getByRole('navigation', { name: '设置分类' });
  const panel = page.getByRole('region', { name: '常规' });
  const desktopNav = await categories.boundingBox();
  const desktopPanel = await panel.boundingBox();
  expect(desktopNav).not.toBeNull();
  expect(desktopPanel).not.toBeNull();
  expect(desktopNav!.x + desktopNav!.width).toBeLessThan(desktopPanel!.x);

  await page.setViewportSize({ width: 390, height: 844 });
  await categories.getByRole('button', { name: '隐私与数据' }).click();
  await expect(page.getByRole('heading', { name: '隐私与数据' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本地数据' })).toBeVisible();
  expect(
    await page
      .getByRole('main', { name: '设置' })
      .evaluate((main) => main.getBoundingClientRect().right <= window.innerWidth)
  ).toBe(true);

  await categories.getByRole('button', { name: 'AI 与模型' }).click();
  await expect(page.getByRole('heading', { name: 'AI 与模型' })).toBeVisible();
  expect(
    await page
      .getByRole('main', { name: '设置' })
      .evaluate((main) => main.getBoundingClientRect().right <= window.innerWidth)
  ).toBe(true);
});
