import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function log(name) {
  const bytes = await fs.readFile(`logs/m5b-${name}.log`);
  return bytes.toString(bytes[0] === 0xff ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
}
const rust = await log('rust-tests');
assert(!/test result: FAILED/.test(rust));
const rustPassed = [...rust.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
  (sum, match) => sum + Number(match[1]),
  0
);
assert(rustPassed >= 295, `Incomplete Rust suite: ${rustPassed}`);
const frontend = await log('frontend');
assert(/Test Files\s+68 passed/.test(frontend));
assert(/Tests\s+301 passed/.test(frontend));
assert(/33 passed/.test(await log('e2e')));
assert(/All matched files use Prettier code style/.test(await log('format')));
assert(/Finished `dev`/.test(await log('clippy')));
assert(/test result: ok\. 1 passed/.test(await log('real-eval')));
assert(/Built application at:/.test(await log('build')));
const quality = JSON.parse(await fs.readFile('logs/m5b-quality.json', 'utf8'));
const model = JSON.parse(await fs.readFile('logs/m5b-model/ready.json', 'utf8'));
const fixtureBytes = await fs.readFile('evals/retrieval/cases.json');
const fixture = JSON.parse(fixtureBytes);
assert(quality.realModel && !quality.remoteInference && !model.remoteInference);
assert.equal(quality.queries, 24);
assert.equal(quality.cases.length, fixture.queries.length);
const mrr = (key) =>
  quality.cases.reduce((sum, c) => sum + (c[key] ? 1 / c[key] : 0), 0) / quality.queries;
assert.equal(quality.lexicalMrrAt5, mrr('lexicalRank'));
assert.equal(quality.hybridMrrAt5, mrr('hybridRank'));
assert(quality.hybridMrrAt5 >= 0.75 && quality.hybridMrrAt5 > quality.lexicalMrrAt5 + 0.05);
for (const [index, row] of quality.cases.entries()) {
  assert.equal(row.query, fixture.queries[index].query);
  assert.equal(row.relevant, fixture.queries[index].relevant);
  assert(row.elapsedMs > 0);
  assert.equal(row.newChunks, index === 0 ? fixture.sources.length : 0);
}
assert.equal(model.revision, '2c4055b12046f11709e9df2c122e59ffbdc2f900');
assert.equal(
  model.modelSha256,
  sha256(await fs.readFile('logs/m5b-model/model/onnx/model_quantized.onnx'))
);
const desktop = JSON.parse(await fs.readFile('logs/m5b-desktop/report.json', 'utf8'));
assert(desktop.passed && desktop.isolated && desktop.credentialsDisabled);
for (const check of [
  'persistent_search',
  'search_reset',
  'search_after_reload',
  'embedding_requires_consent',
  'hybrid_real_model',
  'embedding_cache',
  'semantic_fallback',
]) {
  assert(desktop.checks.includes(check));
}
assert.deepEqual(desktop.pageErrors, []);
const artifact = 'logs/m5b-hybrid-search-review/a2ui-terminal.exe';
const binary = await fs.readFile(artifact);
assert.equal(sha256(binary), desktop.binarySha256);
const warm = quality.cases
  .slice(1)
  .map((c) => c.elapsedMs)
  .sort((a, b) => a - b);
const evidence = {
  stage: 'M5-B',
  generatedAt: new Date().toISOString(),
  passed: true,
  artifact,
  binarySha256: desktop.binarySha256,
  binaryBytes: binary.length,
  rustPassed,
  rustIgnored: 2,
  realModelTestsPassed: 1,
  frontendPassed: 301,
  frontendFiles: 68,
  e2ePassed: 33,
  quality,
  fixtureSha256: sha256(fixtureBytes),
  model,
  latency: {
    scope:
      '12 synthetic documents, embedding requests plus ranking; excludes planning and model loading',
    firstQueryWithEmbeddingBuildMs: quality.cases[0].elapsedMs,
    warmSamples: warm.length,
    warmP95Ms: warm[Math.ceil(warm.length * 0.95) - 1],
    cloudInferenceCost: 0,
    largeVectorCorpusBenchmarked: false,
  },
  desktop,
  humanAcceptance: 'pending',
};
await fs.writeFile('logs/m5b-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  `M5-B evidence verified: ${rustPassed} Rust tests, real-model MRR@5 ${quality.hybridMrrAt5.toFixed(3)}, matching desktop binary.`
);
