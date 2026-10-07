import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('canvas-e2e-initialized')) {
      localStorage.clear();
      sessionStorage.setItem('canvas-e2e-initialized', 'true');
    }
    localStorage.setItem('a2ui.onboarding-complete.v1', 'true');
  });
  await page.goto('/#/workbench');
  await expect(page.getByTestId('workspace-layout')).toBeVisible();
});

test('opens a file canvas inside the workbench and preserves spatial edits', async ({ page }) => {
  const workbench = page.getByTestId('workspace-layout');
  await workbench.getByRole('button', { name: '打开画布' }).click();
  await expect(workbench.getByRole('tab', { name: 'README.md · 画布' })).toBeVisible();
  await expect(workbench.locator('.react-flow__pane')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' }).getByText('画布')).toHaveCount(0);

  await workbench.locator('.react-flow__pane').dblclick({ position: { x: 170, y: 160 } });
  await expect(workbench.getByText('添加到画布')).toBeVisible();
  await workbench.getByText('笔记', { exact: true }).click();
  const note = workbench.locator('[data-testid^="canvas-node-"]');
  await expect(note).toHaveCount(1);
  await note.dblclick();
  await workbench.getByRole('textbox', { name: '笔记内容' }).fill('论文研究问题与我的感悟');
  await note.getByRole('button', { name: '完成', exact: true }).click();
  await expect(note).toContainText('论文研究问题与我的感悟');

  const before = await note.boundingBox();
  const heading = note.locator('[class*=nodeHeading]');
  await heading.hover();
  await page.mouse.down();
  await page.mouse.move(before!.x + 220, before!.y + 150, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const raw = await page.evaluate(() =>
        localStorage.getItem('a2ui.spatial-canvases.v1.web-mock')
      );
      const saved = JSON.parse(raw ?? '[]');
      return saved[0]?.blocks?.[0]?.body;
    })
    .toContain('论文研究问题与我的感悟');
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('a2ui.spatial-canvases.v1.web-mock') ?? '[]')[0].blocks[0]
  );
  expect(saved.x).toBeGreaterThan(0);
  expect(saved.width).toBeGreaterThanOrEqual(160);

  await page.reload();
  await workbench
    .getByRole('tablist', { name: '左侧资源视图' })
    .getByRole('tab', { name: '画布' })
    .click();
  await page.getByRole('button', { name: /README.md · 画布 README.md/ }).click();
  await expect(workbench.locator('[data-testid^="canvas-node-"]')).toContainText(
    '论文研究问题与我的感悟'
  );
});

test('creates independent and folder canvases in the canvas resource panel', async ({ page }) => {
  const workbench = page.getByTestId('workspace-layout');
  await workbench
    .getByRole('tablist', { name: '左侧资源视图' })
    .getByRole('tab', { name: '画布' })
    .click();
  await workbench.getByRole('button', { name: '新建' }).click();
  await page.getByRole('dialog', { name: '新建画布' }).getByRole('textbox').fill('独立研究图');
  await page.getByRole('button', { name: '创建并打开' }).click();
  await expect(workbench.getByRole('tab', { name: '独立研究图' })).toBeVisible();

  await workbench.getByRole('button', { name: '新建' }).click();
  const dialog = page.getByRole('dialog', { name: '新建画布' });
  await dialog.getByRole('textbox').fill('项目结构');
  await dialog.getByText('独立画布').click();
  await page.getByText('文件夹', { exact: true }).last().click();
  await dialog.getByRole('combobox').last().click();
  await page.getByText('src', { exact: true }).last().click();
  await page.getByRole('button', { name: '创建并打开' }).click();
  await expect(workbench.getByRole('tab', { name: '项目结构' })).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('a2ui.spatial-canvases.v1.web-mock') ?? '[]')
  );
  expect(saved.map((item: { binding: { type: string } }) => item.binding.type)).toEqual([
    'folder',
    'none',
  ]);
});

test('edits a note with the top formatting toolbar and keeps rich text after reload', async ({
  page,
}) => {
  const workbench = page.getByTestId('workspace-layout');
  await workbench.getByRole('button', { name: '打开画布' }).click();
  await workbench.getByRole('button', { name: /添加$/ }).first().click();
  await workbench.locator('[class*=paletteItems] button').filter({ hasText: '笔记' }).click();
  const note = workbench.locator('[data-testid^="canvas-node-"]');
  await note.click();
  const editor = note.getByRole('textbox', { name: '笔记内容' });
  await editor.fill('研究结论');
  await editor.press('ControlOrMeta+A');
  await note.getByRole('button', { name: '加粗' }).click();
  await note.getByRole('button', { name: '高亮 #ffe38b' }).click();
  await note.getByRole('button', { name: '完成', exact: true }).click();
  await expect(note.locator('[class*=noteText] strong,[class*=noteText] b')).toContainText('研究结论');
  await expect(note.locator('[class*=noteText] strong,[class*=noteText] b')).toHaveCSS('background-color', 'rgb(255, 227, 139)');
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('a2ui.spatial-canvases.v1.web-mock') ?? '[]')[0]
            ?.blocks?.[0]?.noteFormat
      )
    )
    .toBe('rich');
  await page.reload();
  await workbench
    .getByRole('tablist', { name: '左侧资源视图' })
    .getByRole('tab', { name: '画布' })
    .click();
  await page.getByRole('button', { name: /README.md · 画布 README.md/ }).click();
  await expect(workbench.locator('[class*=noteText] strong,[class*=noteText] b')).toContainText('研究结论');
});

test('persists resized nodes and semantic edges', async ({ page }) => {
  const workbench = page.getByTestId('workspace-layout');
  await workbench.getByRole('button', { name: '打开画布' }).click();
  await expect(workbench.locator('.react-flow__pane')).toBeVisible();
  for (let index = 0; index < 2; index += 1) {
    await workbench.getByRole('button', { name: /添加$/ }).first().click();
    await workbench.locator('[class*=paletteItems] button').filter({ hasText: '笔记' }).click();
  }
  const nodes = workbench.locator('.react-flow__node');
  await expect(nodes).toHaveCount(2);
  const source = await nodes.nth(0).locator('.react-flow__handle.source').boundingBox();
  const target = await nodes.nth(1).locator('.react-flow__handle.target').boundingBox();
  await page.mouse.move(source!.x + 4, source!.y + 4);
  await page.mouse.down();
  await page.mouse.move(target!.x + 4, target!.y + 4, { steps: 10 });
  await page.mouse.up();
  await expect(workbench.locator('.react-flow__edge')).toHaveCount(1);

  await nodes.nth(0).locator('[class*=nodeHeading]').click();
  const handle = await workbench
    .locator('.react-flow__resize-control.bottom.right.handle')
    .boundingBox();
  await page.mouse.move(handle!.x + 2, handle!.y + 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 82, handle!.y + 52, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const item = JSON.parse(
          localStorage.getItem('a2ui.spatial-canvases.v1.web-mock') ?? '[]'
        )[0];
        return Boolean(item?.blocks?.[0]?.width >= 340 && item.edges?.length === 1);
      })
    )
    .toBe(true);
});

test('opens and preserves legacy canvases with structured source metadata', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem(
      'a2ui.spatial-canvases.v1.web-mock',
      JSON.stringify([
        {
          id: 'legacy-canvas',
          workspaceId: 'web-mock',
          title: '旧版论文画布',
          binding: { type: 'none' },
          version: 1,
          blocks: [
            {
              id: 'legacy-quote',
              type: 'quote',
              title: '研究问题',
              body: '旧版引用内容',
              source: {
                label: '论文原文',
                locator: { path: 'paper.pdf', page: 3 },
                revision: 'r1',
                generatedAt: '2026-10-01T00:00:00Z',
              },
              createdAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-10-01T00:00:00Z',
            },
            {
              id: 'legacy-diagram',
              type: 'diagram',
              title: '研究流程',
              body: '研究问题 -> 方法\n方法 -> 结论',
              source: { label: '旧版图解', revision: null, locator: null, generatedAt: null },
              createdAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-10-01T00:00:00Z',
            },
            {
              id: 'legacy-summary',
              type: 'summary',
              title: '旧版摘要',
              body: JSON.stringify({
                type: 'document_patch',
                changes: [{ content: '# 核心贡献\n\n- 可读的结论' }],
              }),
              createdAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-10-01T00:00:00Z',
            },
            {
              id: 'legacy-a2ui',
              type: 'a2ui',
              title: '旧版组件',
              body: JSON.stringify({
                kind: 'data',
                data: [
                  { version: 'v0.9.1', createSurface: { surfaceId: 'research-card' } },
                  {
                    updateComponents: {
                      components: [
                        { id: 'root', component: 'Column', props: {}, children: ['title'] },
                        { id: 'title', component: 'Text', props: { text: '论文结构图' } },
                      ],
                    },
                  },
                ],
              }),
              createdAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-10-01T00:00:00Z',
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ])
    );
  });
  await page.reload();
  const workbench = page.getByTestId('workspace-layout');
  await workbench
    .getByRole('tablist', { name: '左侧资源视图' })
    .getByRole('tab', { name: '画布' })
    .click();
  await workbench
    .getByRole('button', { name: /旧版论文画布/ })
    .first()
    .click();
  await expect(workbench.getByText('页面加载失败，请重试')).toHaveCount(0);
  await expect(workbench.locator('[data-testid^="canvas-node-"]').first()).toContainText(
    '论文原文'
  );
  await expect(workbench.locator('[data-testid^="canvas-node-"]').first()).toContainText(
    '旧版引用内容'
  );
  await expect(workbench.locator('[data-testid^="canvas-node-"]').nth(1)).toContainText(
    '研究问题 -> 方法'
  );
  await expect(workbench.locator('[data-testid^="canvas-node-"]').nth(2)).toContainText(
    '可读的结论'
  );
  await expect(workbench.locator('[data-testid^="canvas-node-"]').nth(2)).not.toContainText(
    'document_patch'
  );
  await expect(workbench.locator('[data-testid^="canvas-node-"]').nth(3)).toContainText(
    '论文结构图'
  );
  await expect(workbench.getByText('图解语法错误')).toHaveCount(0);
  await workbench.locator('[data-testid^="canvas-node-"]').first().dblclick();
  await workbench.getByRole('textbox', { name: '组件内容' }).fill('旧版引用已校对');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const saved = JSON.parse(
          localStorage.getItem('a2ui.spatial-canvases.v1.web-mock') ?? '[]'
        )[0];
        return saved.blocks[0].legacySource?.locator?.page;
      })
    )
    .toBe(3);
});

test('draws and persists a graphical flowchart without Mermaid input', async ({ page }) => {
  const workbench = page.getByTestId('workspace-layout');
  await workbench.getByRole('button', { name: '打开画布' }).click();
  await workbench.getByRole('button', { name: /添加$/ }).first().click();
  await workbench.locator('[class*=paletteItems] button').filter({ hasText: '流程图' }).click();
  const editor = page.getByRole('dialog', { name: '绘制流程图' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: '步骤' }).click();
  await editor.getByRole('button', { name: '判断' }).click();
  await expect(editor.locator('.react-flow__node')).toHaveCount(2);
  await editor.locator('.react-flow__node').first().dblclick();
  await editor.getByRole('textbox', { name: '流程节点文字' }).fill('读取论文');
  await editor.getByRole('textbox', { name: '流程节点文字' }).press('Enter');
  const source = await editor
    .locator('.react-flow__node')
    .first()
    .locator('.react-flow__handle.source')
    .boundingBox();
  const target = await editor
    .locator('.react-flow__node')
    .nth(1)
    .locator('.react-flow__handle.target')
    .boundingBox();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(editor.locator('.react-flow__edge')).toHaveCount(1);
  await expect(editor.locator('.react-flow__edge-path')).toHaveAttribute('marker-end', /url\('/);
  await editor.getByRole('button', { name: '保存到画布' }).click();
  await expect(workbench.getByRole('img', { name: '流程图预览' })).toBeVisible();
  await expect(
    workbench.getByRole('img', { name: '流程图预览' }).locator('path[marker-end]')
  ).toHaveCount(1);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('a2ui.spatial-canvases.v1.web-mock') ?? '[]')[0]
            ?.blocks?.[0]?.flowchart?.nodes?.length
      )
    )
    .toBe(2);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('a2ui.spatial-canvases.v1.web-mock') ?? '[]')[0]
            ?.blocks?.[0]?.flowchart?.edges?.length
      )
    )
    .toBe(1);
  const flowNode = workbench.locator('[data-testid^="canvas-node-"]');
  await flowNode.locator('[class*=nodeHeading]').hover();
  await flowNode.getByRole('button', { name: '编辑组件' }).click();
  await expect(
    page.getByRole('dialog', { name: '绘制流程图' }).locator('.react-flow__node')
  ).toHaveCount(2);
  await page.getByRole('dialog', { name: '绘制流程图' }).locator('.react-flow__edge').click();
  await page.getByRole('dialog', { name: '绘制流程图' }).getByText('─ 直线').click();
  await page
    .getByRole('dialog', { name: '绘制流程图' })
    .getByRole('button', { name: '保存到画布' })
    .click();
  await expect(
    workbench.getByRole('img', { name: '流程图预览' }).locator('path[marker-end]')
  ).toHaveCount(0);
  await expect(workbench.getByText('图解语法错误')).toHaveCount(0);
});

test('imports CSV as a visible table and excludes ordinary documents', async ({ page }) => {
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /成果与协作/ })
    .click();
  await page.getByRole('button', { name: '新建成果' }).click();
  let dialog = page.getByRole('dialog', { name: '新建成果' });
  await dialog.getByLabel('成果标题').fill('画布数据表');
  await dialog.getByLabel('成果类型').click();
  await page.getByText('表格（CSV）', { exact: true }).last().click();
  await dialog.getByLabel('本地文件名').fill('画布数据表.csv');
  await dialog.getByRole('button', { name: '创建并打开' }).click();
  await page.getByText('编辑', { exact: true }).click();
  await page.getByRole('textbox', { name: '成果编辑器' }).fill('月份,收入\n一月,100\n');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 5000 });
  const workbench = page.getByTestId('workspace-layout');
  await workbench
    .getByRole('tablist', { name: '左侧资源视图' })
    .getByRole('tab', { name: '画布' })
    .click();
  await workbench.getByRole('button', { name: '新建' }).click();
  const createCanvas = page.getByRole('dialog', { name: '新建画布' });
  await createCanvas.getByRole('textbox').fill('成果可视化画布');
  await createCanvas.getByRole('button', { name: '创建并打开' }).click();
  await workbench.getByRole('button', { name: /添加$/ }).first().click();
  await workbench.locator('[class*=paletteItems] button').filter({ hasText: '成果' }).click();
  dialog = page.getByRole('dialog', { name: '导入可视化成果' });
  await dialog.getByRole('combobox').click();
  await page.getByText('表格 · 画布数据表').last().click();
  await dialog.getByRole('button', { name: /添\s*加/ }).click();
  await expect(workbench.getByRole('table')).toContainText('月份');
  await expect(workbench.getByRole('table')).toContainText('一月');
  await expect(workbench.getByRole('table')).toContainText('100');
  await expect(
    workbench.locator('[class*=paletteItems] button').filter({ hasText: '添加文件' })
  ).toHaveCount(0);
});

test('keeps canvas text readable in dark eye-care mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => localStorage.setItem('a2ui.workbench.eye-care.v1', 'true'));
  await page.reload();
  const workbench = page.getByTestId('workspace-layout');
  await expect(page.locator('[data-eye-care="true"]')).toBeVisible();
  await workbench.getByRole('button', { name: '打开画布' }).click();
  await workbench.getByRole('button', { name: /添加$/ }).first().click();
  await workbench.locator('[class*=paletteItems] button').filter({ hasText: '笔记' }).click();
  const node = workbench.locator('[data-testid^="canvas-node-"]');
  await node.dblclick();
  await node.getByRole('textbox', { name: '笔记内容' }).fill('深色模式下清晰可读的笔记');
  await node.getByRole('button', { name: '完成', exact: true }).click();
  const colors = await node.evaluate((element) => {
    const body = element.querySelector('[class*=nodeBody]') as HTMLElement;
    return {
      foreground: getComputedStyle(body).color,
      background: getComputedStyle(element).backgroundColor,
    };
  });
  expect(colors.foreground).not.toBe(colors.background);
  await expect(node).toContainText('深色模式下清晰可读的笔记');
  await page.screenshot({ path: 'test-results/canvas-dark-eye-care.png' });
});

test('persists note highlighting and custom colors', async ({ page }) => {
  const workbench = page.getByTestId('workspace-layout');
  await workbench.getByRole('button', { name: '打开画布' }).click();
  await workbench.getByRole('button', { name: /添加$/ }).first().click();
  await workbench.locator('[class*=paletteItems] button').filter({ hasText: '笔记' }).click();
  const note = workbench.locator('[data-testid^="canvas-node-"]');
  await note.dblclick();
  const editor = note.getByRole('textbox', { name: '笔记内容' });
  await editor.fill('重要观点和感悟');
  await editor.press('Home');
  for (let index = 0; index < 4; index += 1) await editor.press('Shift+ArrowRight');
  await note.getByRole('button', { name: '高亮 #ffe38b' }).click();
  await note.getByRole('button', { name: '笔记底色 #f8dcec' }).click();
  await note.getByRole('button', { name: '完成', exact: true }).click();
  await expect(note.locator('[class*=noteText] mark,[class*=noteText] span[style*="background"]')).toContainText('重要观点');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const saved = JSON.parse(
          localStorage.getItem('a2ui.spatial-canvases.v1.web-mock') ?? '[]'
        )[0];
        return saved?.blocks?.[0] ? [saved.blocks[0].body.includes('重要观点'), saved.blocks[0].noteStyle.background] : null;
      })
    )
    .toEqual([true, '#f8dcec']);
});
