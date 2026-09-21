import { expect, test } from '@playwright/test';

test('quick controls, empty-state navigation and live system theme work at compact width', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('a2ui.onboarding-complete.v1', 'true'));
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('home-light.png') });
  await page.getByRole('button', { name: '使用模式', exact: true }).click();
  await page.getByRole('menuitem', { name: '专业模式' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '使用模式', exact: true })).toContainText(
    '专业模式'
  );
  await navigation.getByRole('button', { name: '模板', exact: true }).click();
  await expect(page.getByRole('button', { name: '浏览内置任务模板' })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await page.screenshot({ path: info.outputPath('templates-dark.png') });
  await page.getByRole('button', { name: '浏览内置任务模板' }).click();
  await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible();
  await page.getByRole('button', { name: '中文' }).click();
  await page.getByRole('menuitem', { name: 'English' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  const headerFits = await page
    .locator('header')
    .first()
    .evaluate((header) => {
      const children = Array.from(header.children).map((child) => child.getBoundingClientRect());
      return children.every(
        (rect, index) =>
          rect.right <= window.innerWidth && (index === 0 || rect.left >= children[index - 1].right)
      );
    });
  expect(headerFits).toBe(true);
  await page.screenshot({ path: info.outputPath('home-dark-english.png') });
});
