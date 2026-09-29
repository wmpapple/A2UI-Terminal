import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

async function log(name) {
  const bytes = await fs.readFile(`logs/m5a-${name}.log`);
  return bytes.toString(bytes[0] === 0xff ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
}

const rust = await log('rust-tests');
assert(!/test result: FAILED/.test(rust));
const rustPassed = [...rust.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
  (sum, match) => sum + Number(match[1]),
  0
);
assert(rustPassed >= 289, `Incomplete Rust suite: ${rustPassed}`);
const benchmarks = [...rust.matchAll(/M5A_REPORT (\{[^\r\n]+\})/g)].map((m) => JSON.parse(m[1]));
assert.equal(benchmarks.length, 2);
for (const sources of [100, 1000]) {
  const row = benchmarks.find((r) => r.sources === sources);
  assert(row);
  assert.equal(row.fragments, sources * 10);
  assert.equal(row.mode, 'persistent_lexical');
  assert.equal(row.warmRebuilt, false);
  assert.equal(row.samples, 20);
  assert(row.warmP95Ms <= 300);
}
const frontend = await log('frontend');
assert(/Test Files\s+67 passed/.test(frontend));
assert(/Tests\s+298 passed/.test(frontend));
assert(/33 passed/.test(await log('e2e')));
assert(/All matched files use Prettier code style/.test(await log('format')));
assert(/Finished `dev`/.test(await log('clippy')));
const desktop = JSON.parse(await fs.readFile('logs/m5a-desktop/report.json', 'utf8'));
assert(desktop.passed && desktop.isolated && desktop.credentialsDisabled);
for (const check of ['persistent_search', 'search_reset', 'search_after_reload']) {
  assert(desktop.checks.includes(check));
}
assert.deepEqual(desktop.pageErrors, []);
const binary = await fs.readFile('logs/m5a-persistent-search-review/a2ui-terminal.exe');
const binarySha256 = createHash('sha256').update(binary).digest('hex');
assert.equal(binarySha256, desktop.binarySha256);
const evidence = {
  stage: 'M5-A',
  generatedAt: new Date().toISOString(),
  passed: true,
  binarySha256,
  binaryBytes: binary.length,
  rustPassed,
  frontendPassed: 298,
  e2ePassed: 33,
  benchmarks,
  desktop,
  modelQualityEvaluated: false,
  hybridRetrievalImplemented: false,
  humanAcceptance: 'pending',
};
await fs.writeFile('logs/m5a-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  `M5-A evidence verified: ${rustPassed} Rust tests, 10,000 fragments, matching desktop binary.`
);
