import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('logs');
const readLog = async (name) => {
  const bytes = await fs.readFile(path.join(root, name));
  return bytes
    .toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8')
    .replace(/^\uFEFF/, '');
};
const integration = await readLog('b0-integration.log');
assert.match(integration, /test result: ok\. 2 passed; 0 failed/);
const reports = [...integration.matchAll(/B0_REPORT (\{[^\r\n]+\})/g)].map((m) => JSON.parse(m[1]));
const workflow = reports.find((r) => r.kind === 'workflow');
const library = reports.find((r) => r.kind === 'library_performance');
assert.equal(workflow?.passed, true);
assert.equal(workflow.credentialsRead, false);
assert.equal(workflow.transport, 'real_loopback_sse');
assert.equal(workflow.requests, 2);
assert.deepEqual(workflow.formats, ['md', 'docx', 'pdf']);
assert.equal(library?.sources, 100);
assert.equal(library.firstPage, 40);
assert.equal(library.warmSamples, 20);
assert.equal(library.largerScaleValidated, false);
const desktop = JSON.parse(await fs.readFile(path.join(root, 'b0-desktop/report.json'), 'utf8'));
assert.equal(desktop.passed, true);
const binary = await fs.readFile(path.resolve('src-tauri/target/debug/a2ui-terminal.exe'));
assert.equal(
  desktop.binarySha256,
  createHash('sha256').update(binary).digest('hex'),
  'Desktop report must match the final binary'
);
assert.equal(desktop.runtime, 'real_tauri_webview2');
assert.equal(desktop.isolated, true);
assert.equal(desktop.credentialsDisabled, true);
assert.equal(desktop.remoteModelEvaluated, false);
assert.equal(desktop.modelRequests, 1);
assert.deepEqual(desktop.pageErrors, []);
for (const check of [
  'profile_prompt',
  'generation_review_apply',
  'input_cleared',
  'autosave',
  'home_return',
  'unknown_citation',
  'webview_reload_persistence',
]) {
  assert(desktop.checks.includes(check), check);
}
const timings = {};
for (const [name, budget] of Object.entries({
  homeInteractive: 2500,
  resultOpen: 1000,
  requestFeedback: 300,
})) {
  const values = desktop.measurements
    .filter((m) => m.name === name)
    .map((m) => m.durationMs)
    .sort((a, b) => a - b);
  assert(values.length >= (name === 'resultOpen' ? 5 : 1), `Missing desktop samples: ${name}`);
  assert(
    values.every((v) => Number.isFinite(v) && v >= 0 && v <= budget),
    `${name} exceeded budget`
  );
  timings[name] = {
    samples: values.length,
    p95Ms: values[Math.ceil(values.length * 0.95) - 1],
    budgetMs: budget,
  };
}
const rustLog = await readLog('b0-rust-tests.log');
const rust = [
  ...rustLog.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored/g),
].reduce(
  (a, m) => ({
    passed: a.passed + Number(m[1]),
    failed: a.failed + Number(m[2]),
    ignored: a.ignored + Number(m[3]),
  }),
  { passed: 0, failed: 0, ignored: 0 }
);
assert(rust.passed >= 281);
assert.equal(rust.failed, 0);
assert(!/test result: FAILED/.test(rustLog));
const frontendLog = await readLog('b0-coverage.log');
const frontend = Number(frontendLog.match(/Tests\s+(\d+) passed/)?.[1]);
assert(frontend >= 297);
assert(!/Tests\s+\d+ failed/.test(frontendLog));
const e2eLog = await readLog('b0-e2e.log');
assert.match(e2eLog, /33 passed/);
assert(!/\d+ failed|\d+ interrupted/.test(e2eLog));
const evidence = {
  capturedAt: new Date().toISOString(),
  passed: true,
  scope: 'B0 integration, not remote-model quality or signed release',
  workflow,
  library,
  desktopTimings: timings,
  rust,
  frontend,
  browserE2e: 33,
};
await fs.writeFile(path.join(root, 'b0-evidence.json'), JSON.stringify(evidence, null, 2));
console.log(
  'B0 evidence verified:',
  JSON.stringify({ frontend, rust, browserE2e: 33, desktopTimings: timings })
);
