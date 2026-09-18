import { expect, test } from '@playwright/test';

type BrowserMeasurement = {
  name: 'homeInteractive' | 'resultOpen' | 'requestFeedback';
  durationMs: number;
  budgetMs: number;
  withinBudget: boolean;
};

const contrastRatio = (foreground: string, background: string) => {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    const [red, green, blue] = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

const preparePage = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() => {
    localStorage.setItem('a2ui.onboarding-complete.v1', 'true');
  });
  await page.goto('/');
};

const measurement = async (
  page: import('@playwright/test').Page,
  name: BrowserMeasurement['name']
) => {
  await page.waitForFunction(
    (metricName) =>
      Boolean(
        (
          window as Window & {
            __A2UI_PERFORMANCE__?: BrowserMeasurement[];
          }
        ).__A2UI_PERFORMANCE__?.some((item) => item.name === metricName)
      ),
    name
  );
  return page.evaluate(
    (metricName) =>
      (
        window as Window & {
          __A2UI_PERFORMANCE__?: BrowserMeasurement[];
        }
      )
        .__A2UI_PERFORMANCE__!.filter((item) => item.name === metricName)
        .at(-1)!,
    name
  );
};

test('measures budgets and completes the core result path with keyboard', async ({
  page,
}, info) => {
  await preparePage(page);
  await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible();
  const homeInteractive = await measurement(page, 'homeInteractive');

  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: '跳到主要内容' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  const palette = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return ['--text', '--text-muted', '--text-strong', '--accent', '--focus-ring'].map((name) => ({
      name,
      value: styles.getPropertyValue(name).trim(),
    }));
  });
  for (const color of palette) {
    expect(contrastRatio(color.value, '#ffffff'), color.name).toBeGreaterThanOrEqual(4.5);
  }

  const writeAction = page.getByRole('button', { name: /写一份文档/ });
  await writeAction.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '创建本地成果草稿' })).toBeVisible();
  const requestFeedback = await measurement(page, 'requestFeedback');
  const closeTask = page.getByRole('button', { name: 'Close' });
  await closeTask.focus();
  await page.keyboard.press('Enter');

  const resultsNavigation = page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /成果$/ });
  await resultsNavigation.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '我的成果' })).toBeVisible();
  await expect(page.getByText('已显示 1 / 共 1 项')).toBeVisible();
  await expect(page.locator('#main-content')).toBeFocused();

  const continueButton = page
    .getByRole('article')
    .first()
    .getByRole('button', { name: /继续处理/ });
  await continueButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: '成果工作区' })).toBeVisible();
  await expect(page.locator('#main-content')).toBeFocused();
  const resultOpen = await measurement(page, 'resultOpen');

  const editMode = page.getByRole('radio', { name: '编辑' });
  await editMode.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('textbox', { name: '成果编辑器' })).toBeVisible();

  const exportButton = page.getByRole('button', { name: /导出$/ });
  await exportButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '导出', exact: true })).toBeVisible();

  const measurements = { homeInteractive, requestFeedback, resultOpen };
  expect(homeInteractive.durationMs).toBeLessThanOrEqual(homeInteractive.budgetMs);
  expect(requestFeedback.durationMs).toBeLessThanOrEqual(requestFeedback.budgetMs);
  expect(resultOpen.durationMs).toBeLessThanOrEqual(resultOpen.budgetMs);
  expect(JSON.stringify(measurements)).not.toMatch(/content|path|workspace|title/i);
  console.info('S4.5 performance measurements', JSON.stringify(measurements));
  await info.attach('performance-measurements.json', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
});
