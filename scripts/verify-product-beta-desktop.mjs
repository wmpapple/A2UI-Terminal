// B0: real WebView2 + Tauri IPC, isolated files/credentials, loopback fixture only.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { verifyLongform } from './verify-longform-workflow.mjs';
import { verifyCritic } from './verify-critic-workflow.mjs';

const binary = path.resolve(process.argv[2] ?? 'src-tauri/target/debug/a2ui-terminal.exe');
const output = path.resolve(process.argv[3] ?? 'logs/b0-desktop');
const verifyHybridSearch = process.argv.includes('--hybrid-search');
const verifyWritingProjects = process.argv.includes('--longform');
const verifyDocumentCritic = process.argv.includes('--critic');
const verifyPersistentSearch = process.argv.includes('--persistent-search') || verifyHybridSearch;
await fs.mkdir(output, { recursive: true });
// A failed rerun must not leave an earlier successful report looking current.
await fs.writeFile(
  path.join(output, 'report.json'),
  JSON.stringify({ passed: false, startedAt: new Date().toISOString() })
);
const binaryBytes = await fs.readFile(binary);
assert(binaryBytes.includes(Buffer.from('A2UI_SMOKE_ISOLATION_V1')));
const binarySha256 = createHash('sha256').update(binaryBytes).digest('hex');
const temp = await fs.realpath(os.tmpdir());
const root = path.join(temp, `a2ui-terminal-smoke-${randomUUID()}`);
await fs.mkdir(root);
const portLease = net.createServer();
await new Promise((resolve) => portLease.listen(0, '127.0.0.1', resolve));
const port = portLease.address().port;
await new Promise((resolve) => portLease.close(resolve));
const received = [];
const answer = '# B0 桌面成果\n\n预算 420 元，尚未批准。';
const fixture = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'b0-fixture' }] }));
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString());
  received.push({ credentialSent: Boolean(req.headers.authorization), payload });
  const criticRequest =
    verifyDocumentCritic &&
    payload.messages?.some((m) => m.content.includes('read-only document critic'));
  const inlineRequest =
    verifyDocumentCritic &&
    payload.messages?.some((m) => m.content.includes('You edit exactly one selected text range'));
  const response = criticRequest
    ? JSON.stringify({
        findings: [
          {
            kind: 'style',
            quote: '预算 420 元，尚未批准。',
            message: '可调整句式，但保留预算及否定关系',
            evidence: null,
          },
        ],
      })
    : inlineRequest
      ? '当前预算为 420 元，仍未获得批准。'
      : verifyWritingProjects && payload.messages?.some((m) => m.content.includes('仅返回 JSON：'))
        ? JSON.stringify({
            sections: [
              { id: null, title: '预算现状', objective: '保留预算和审批状态', targetWords: 300 },
              { id: null, title: '后续行动', objective: '讨论下一步建议', targetWords: 300 },
            ],
          })
        : answer;
  res.setHeader('Content-Type', 'text/event-stream');
  res.end(
    `data: ${JSON.stringify({ choices: [{ delta: { content: response } }] })}\n\ndata: [DONE]\n\n`
  );
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${fixture.address().port}/v1`;
const child = spawn(binary, ['--smoke-test-root', root], {
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
  },
});
const launchAt = performance.now();
let browser;
let page;
const pageErrors = [];
try {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Desktop exited: ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(700),
      });
      if (response.ok) break;
    } catch {
      /* WebView starts after native initialization. */
    }
    await delay(150);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10_000 });
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? (await context.waitForEvent('page'));
  page.setDefaultTimeout(12_000);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__));
  const receipt = JSON.parse(await fs.readFile(path.join(root, 'ready.json'), 'utf8'));
  assert.equal(receipt.credentialsDisabled, true);
  assert.equal(receipt.protocol, 'A2UI_SMOKE_ISOLATION_V1');
  await page.evaluate(() => {
    localStorage.setItem('a2ui.onboarding-complete.v1', 'true');
    localStorage.setItem('a2ui.locale.v1', 'zh-CN');
  });
  // Use existing public IPC only; no test-only import or permission bypass.
  await page.evaluate(async (endpoint) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    await invoke('save_provider_config', {
      config: {
        id: 'openai',
        kind: 'open_ai',
        endpoint,
        model: 'b0-fixture',
        temperature: 0,
        proxyUrl: null,
      },
      secret: null,
    });
    await invoke('set_active_provider', { providerId: 'openai' });
    await invoke('save_writing_profile', {
      input: {
        scope: 'global',
        workspaceId: null,
        enabled: true,
        rules: '先给结论，每段不超过三句',
        terminology: [],
        forbiddenWords: ['赋能'],
        exampleKnowledgeIds: [],
      },
    });
  }, endpoint);
  await page.reload();
  await expect(page.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible();
  const launchToHomeMs = performance.now() - launchAt;
  await page.waitForFunction(() =>
    window.__A2UI_PERFORMANCE__?.some((m) => m.name === 'homeInteractive')
  );
  const homeMeasurements = await page.evaluate(() => window.__A2UI_PERFORMANCE__ ?? []);
  await page.getByRole('button', { name: '新建成果' }).click();
  const create = page.getByRole('dialog', { name: '新建成果' });
  await create.getByLabel('成果标题').fill('B0 桌面成果');
  await create.getByLabel('本地文件名').fill('b0-desktop.md');
  await create.getByRole('button', { name: '创建并打开' }).click();
  await expect(page.getByRole('region', { name: '成果工作区' })).toBeVisible();
  await page.getByRole('textbox', { name: '写作要求' }).fill('写一份预算 420 元、尚未批准的简报');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认 AI 写作发送范围' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '确认并生成' }).click();
  const review = page.getByRole('dialog', { name: '审阅 AI 写作提案' });
  await expect(review).toContainText('420');
  await review.getByRole('button', { name: '接受并写入成果' }).click();
  await expect(review).toBeHidden();
  await page.getByText('编辑', { exact: true }).click();
  const editor = page.getByRole('textbox', { name: '成果编辑器' });
  await expect(editor).toHaveValue(answer);
  await expect(page.getByRole('textbox', { name: '写作要求' })).toHaveValue('');
  assert.equal(received.length, 1);
  assert.equal(received[0].credentialSent, false);
  assert.match(received[0].payload.messages[0].content, /先给结论/);
  const edited = `${answer}\n\n人工补充 [S999]`;
  await editor.fill(edited);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: '首页', exact: true }).click();
  await navigation.getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByText('编辑', { exact: true }).click();
  await expect(editor).toHaveValue(edited);
  const references = page.getByRole('region', { name: '引用来源' });
  await references.getByRole('button', { name: /\[S999\].*未知引用/ }).click();
  await expect(page.getByRole('dialog').getByText('未知引用', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  // Reload WebView to validate persisted native result and restore route state.
  await page.reload();
  await navigation.getByRole('button', { name: '成果', exact: true }).click();
  await page
    .getByRole('article')
    .filter({ hasText: 'B0 桌面成果' })
    .getByRole('button', { name: /继续处理/ })
    .click();
  await page.getByText('编辑', { exact: true }).click();
  await expect(editor).toHaveValue(edited);
  // Repeated warm opens are reported separately from the launch interval.
  for (let i = 0; i < 4; i++) {
    await navigation.getByRole('button', { name: '成果', exact: true }).click();
    await page
      .getByRole('article')
      .filter({ hasText: 'B0 桌面成果' })
      .getByRole('button', { name: /继续处理/ })
      .click();
    await expect(page.getByRole('region', { name: '成果工作区' })).toBeVisible();
    await page.getByText('编辑', { exact: true }).click();
    await expect(page.getByRole('textbox', { name: '成果编辑器' })).toHaveValue(edited);
  }
  // Search verification reloads the WebView; preserve the workflow measurements
  // before that reload clears the page's in-memory performance buffer.
  const workflowMeasurements = await page.evaluate(() => window.__A2UI_PERFORMANCE__ ?? []);
  if (verifyPersistentSearch) {
    await navigation.getByRole('button', { name: '首页', exact: true }).click();
    const search = page.getByRole('region', { name: '搜索本地内容' });
    const input = search.getByRole('textbox');
    await input.fill('尚未批准');
    await expect(search.getByRole('article').filter({ hasText: 'B0 桌面成果' })).toBeVisible();
    const native = await page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke('search_authorized_content', {
        input: { workspaceId: null, query: '尚未批准', limit: 20 },
      })
    );
    assert.equal(native.indexMode, 'persistent_lexical');
    assert.equal(native.items.length, 1);
    await search.getByRole('button', { name: '修复搜索' }).click();
    await expect(page.getByText('已重置搜索，下次搜索会自动重新整理资料。')).toBeVisible();
    await expect(search.getByRole('article').filter({ hasText: 'B0 桌面成果' })).toBeVisible();
    await page.reload();
    await input.fill('尚未批准');
    await expect(search.getByRole('article').filter({ hasText: 'B0 桌面成果' })).toBeVisible();
    await page.screenshot({ path: path.join(output, 'persistent-search.png') });
  }
  if (verifyHybridSearch) {
    const modelEndpoint = process.env.M5B_EMBEDDING_ENDPOINT;
    assert(modelEndpoint?.startsWith('http://127.0.0.1:'));
    const modelStats = async () => (await fetch(`${modelEndpoint}/models`)).json();
    const before = await modelStats();
    const saveEndpoint = async (endpoint) =>
      page.evaluate(async (endpoint) => {
        await window.__TAURI_INTERNALS__.invoke('save_provider_config', {
          config: {
            id: 'custom',
            kind: 'custom',
            endpoint,
            model: 'unused-chat-model',
            temperature: 0,
            proxyUrl: null,
          },
          secret: null,
        });
      }, endpoint);
    await saveEndpoint(modelEndpoint);
    const search = page.getByRole('region', { name: '搜索本地内容' });
    await search.getByRole('button', { name: '语义搜索', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '语义搜索与发送范围' });
    await dialog.getByRole('combobox', { name: '处理服务' }).click();
    await page.getByText(`custom · ${modelEndpoint}`, { exact: true }).click();
    await dialog
      .getByRole('textbox', { name: '向量模型名称', exact: true })
      .fill('multilingual-minilm');
    await dialog.getByRole('textbox', { name: '模型版本标记', exact: true }).fill(before.revision);
    await dialog.getByRole('button', { name: '规划发送范围' }).click();
    await expect(dialog.getByRole('button', { name: '确认并搜索' })).toBeVisible();
    assert.equal((await modelStats()).requests, before.requests);
    await dialog.getByRole('button', { name: '确认并搜索' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('已结合关键词与语义匹配排序。')).toBeVisible();
    assert.equal((await modelStats()).requests, before.requests + 2);
    await search.getByRole('button', { name: '语义搜索', exact: true }).click();
    await expect(dialog).toContainText('需发送 0 个新片段');
    await dialog.getByRole('button', { name: '确认并搜索' }).click();
    await expect(dialog).toBeHidden();
    assert.equal((await modelStats()).requests, before.requests + 3);
    await page.screenshot({ path: path.join(output, 'hybrid-search.png') });
    await saveEndpoint('http://127.0.0.1:9/v1');
    await search.getByRole('button', { name: '语义搜索', exact: true }).click();
    await expect(dialog).toContainText('http://127.0.0.1:9/v1');
    await dialog.getByRole('button', { name: '确认并搜索' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/向量服务连接失败.*已返回关键词搜索结果/)).toBeVisible();
    await expect(search.getByRole('article').filter({ hasText: 'B0 桌面成果' })).toBeVisible();
  }
  const measurements = [...homeMeasurements, ...workflowMeasurements];
  const writingChecks = verifyWritingProjects ? await verifyLongform(page, received) : [];
  const criticChecks = verifyDocumentCritic ? await verifyCritic(page, received) : [];
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  for (const name of ['homeInteractive', 'resultOpen', 'requestFeedback']) {
    const values = measurements.filter((m) => m.name === name);
    assert(values.length > 0, `Missing measurement: ${name}`);
    for (const metric of values) assert(metric.withinBudget, JSON.stringify(metric));
  }
  await page.screenshot({ path: path.join(output, 'desktop-result.png') });
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        binarySha256,
        runtime: 'real_tauri_webview2',
        isolated: true,
        credentialsDisabled: true,
        provider: 'loopback_sse_fixture',
        remoteModelEvaluated: false,
        modelRequests: received.length,
        launchToHomeIncludingSetupMs: launchToHomeMs,
        measurements,
        checks: [
          ...writingChecks,
          ...criticChecks,
          'profile_prompt',
          'generation_review_apply',
          'input_cleared',
          'autosave',
          'home_return',
          'unknown_citation',
          'webview_reload_persistence',
          ...(verifyPersistentSearch
            ? ['persistent_search', 'search_reset', 'search_after_reload']
            : []),
          ...(verifyHybridSearch
            ? [
                'embedding_requires_consent',
                'hybrid_real_model',
                'embedding_cache',
                'semantic_fallback',
              ]
            : []),
        ],
        pageErrors,
      },
      null,
      2
    )
  );
  console.log('B0 real desktop integration passed; report:', path.join(output, 'report.json'));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await fs.writeFile(
      path.join(output, 'failure.txt'),
      await page
        .locator('body')
        .innerText()
        .catch(() => 'Page unavailable')
    );
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      /* already exited */
    }
  }
  fixture.closeAllConnections();
  await new Promise((resolve) => fixture.close(resolve));
  // Delete only the exact fresh directory created by this invocation.
  const resolved = await fs.realpath(root);
  assert.equal(path.dirname(resolved).toLowerCase(), temp.toLowerCase());
  assert.match(path.basename(resolved), /^a2ui-terminal-smoke-[0-9a-f-]{36}$/);
  assert(!(await fs.lstat(root)).isSymbolicLink());
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
}
