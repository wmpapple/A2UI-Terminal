import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function log(name) {
  const bytes = await fs.readFile(`logs/m6-${name}.log`);
  return bytes.toString(bytes[0] === 0xff ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
}
const rust = await log('rust-full');
assert(!rust.includes('test result: FAILED'));
const rustPassed = [...rust.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
  (sum, match) => sum + Number(match[1]),
  0
);
const rustIgnored = [
  ...rust.matchAll(/test result: ok\. \d+ passed; \d+ failed; (\d+) ignored/g),
].reduce((sum, match) => sum + Number(match[1]), 0);
assert(rustPassed >= 300);
const frontend = await log('frontend');
assert(/3 passed/.test(await log('scroll-e2e')));
assert(/Test Files\s+69 passed/.test(frontend));
assert(/Tests\s+303 passed/.test(frontend));
assert(/34 passed/.test(await log('e2e-full')));
assert(!/\d+ failed/.test(await log('e2e-full')));
assert(/All matched files use Prettier code style/.test(await log('prettier-check')));
assert(/Finished `dev`/.test(await log('clippy')));
assert(/Built application at:/.test(await log('desktop-build')));
assert(/test result: ok\. 1 passed/.test(await log('model-eval')));
const desktop = JSON.parse(await fs.readFile('logs/m6-desktop/report.json', 'utf8'));
assert(desktop.passed && desktop.isolated && desktop.credentialsDisabled);
assert.deepEqual(desktop.pageErrors, []);
for (const check of [
  'longform_outline_confirmation',
  'longform_serial_chapters',
  'longform_consent_no_early_request',
  'longform_draft_navigation_reload',
  'longform_summary_context',
  'longform_result_assembly',
])
  assert(desktop.checks.includes(check));
const artifact = 'logs/m6-scroll-fix-review/a2ui-terminal.exe';
const binary = await fs.readFile(artifact);
assert.equal(sha(binary), desktop.binarySha256);
const quality = JSON.parse(await fs.readFile('logs/m6-model/scores.json', 'utf8'));
assert.equal(quality.fixtureSha256, sha(await fs.readFile('evals/longform/cases.json')));
assert.equal(
  quality.model.modelSha256,
  sha(await fs.readFile('logs/m6-model/model/onnx/model_q4.onnx'))
);
const review = JSON.parse(await fs.readFile('evals/longform/manual-review.json', 'utf8'));
assert.equal(review.resultsSha256, sha(await fs.readFile('logs/m6-model/results.json')));
assert.equal(review.promptVersion, quality.promptVersion);
assert.equal(review.cases.length, quality.scores.length);
const evidence = {
  stage: 'M6',
  status: 'engineering_verified_awaiting_product_acceptance',
  generatedAt: new Date().toISOString(),
  baselineCommit: 'ebceca7',
  previousStage: 'M5-B_product_accepted',
  nextStageAuthorized: false,
  schemaVersion: 26,
  engineeringPassed: true,
  artifact,
  binarySha256: desktop.binarySha256,
  binaryBytes: binary.length,
  rustPassed,
  rustIgnored,
  frontendPassed: 303,
  frontendFiles: 69,
  e2ePassed: 34,
  scrollRegressionPassed: 3,
  desktop,
  quality,
  modelQualifiedOnFixedCases: quality.automatedPassed && review.passed,
  manualReview: review,
  humanAcceptance: 'pending',
};
await fs.writeFile('logs/m6-evidence.json', JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify(
    {
      engineeringPassed: true,
      modelQualifiedOnFixedCases: evidence.modelQualifiedOnFixedCases,
      rustPassed,
      frontendPassed: 303,
      e2ePassed: 34,
      binarySha256: evidence.binarySha256,
    },
    null,
    2
  )
);
