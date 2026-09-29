import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const evidence = {};
async function read(file) {
  const bytes = await fs.readFile(file);
  evidence[file] = sha(bytes);
  return bytes.toString(bytes[0] === 0xff ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
}
const log = (name) => read(`logs/m8-${name}.log`);
const rust = await log('rust-tests');
assert(rust.includes('Doc-tests a2ui_terminal_lib') && !/test result: FAILED|error\[E/.test(rust));
const rustPassed = [...rust.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
  (n, m) => n + Number(m[1]),
  0
);
assert(rustPassed >= 322);
const frontend = await log('frontend-tests');
const frontendFiles = Number(frontend.match(/Test Files\s+(\d+) passed/)?.[1]);
const frontendPassed = Number(frontend.match(/Tests\s+(\d+) passed/)?.[1]);
assert(frontendFiles >= 71 && frontendPassed >= 317 && !/\d+ failed/.test(frontend));
const e2e = await log('e2e');
assert(/37 passed/.test(e2e) && !/\d+ failed/.test(e2e));
assert(!/error TS\d/.test(await log('typecheck')));
assert(/Tests\s+17 passed/.test(await log('ui-tests')));
assert(!/✖|error\s+/.test(await log('lint')));
assert(/All matched files use Prettier code style/.test(await log('format')));
assert(/Finished `dev`/.test(await log('clippy')));
assert(/Built application at:/.test(await log('desktop-build')));
const desktop = JSON.parse(await read('logs/m8-desktop/report.json'));
assert(desktop.passed && desktop.isolated && desktop.credentialsDisabled);
assert.deepEqual(desktop.pageErrors, []);
for (const check of [
  'structured_table_review_before_write',
  'structured_stable_ids',
  'structured_discard',
  'structured_insert',
  'structured_stale_candidate_blocked',
  'structured_webview_reload',
  'structured_zero_model_requests',
  'structured_rich_text_formatting',
])
  assert(desktop.checks.includes(check));
const artifact = 'logs/m8-structured-review/a2ui-terminal.exe';
const binary = await fs.readFile(artifact);
assert.equal(sha(binary), desktop.binarySha256);
for (const file of [
  'src-tauri/src/domain/structured_document.rs',
  'src-tauri/src/application/structured_document.rs',
  'src-tauri/src/application/structured_markdown.rs',
  'src-tauri/src/application/structured_docx.rs',
  'src-tauri/src/application/review.rs',
  'src-tauri/src/repository/structured_document.rs',
  'src-tauri/migrations/0028_document_structures.sql',
  'src-tauri/tests/structured_document.rs',
  'src/features/structuredDocument/StructuredDocumentPanel.tsx',
  'src/features/structuredDocument/editorAdapter.ts',
  'src/features/structuredDocument/StructuredDocumentPanel.test.tsx',
  'src/app/i18n/messages.ts',
  'src/shared/markdown/renderSafeMarkdown.ts',
  'src/shared/types/structuredDocument.ts',
  'scripts/verify-structured-workflow.mjs',
  'docs/V2.X/M8_EDITOR_ADR.md',
])
  evidence[file] = sha(await fs.readFile(file));
const output = {
  stage: 'M8',
  status: 'engineering_verified_awaiting_product_acceptance',
  generatedAt: new Date().toISOString(),
  baselineCommit: '7f66ced',
  previousStage: 'M7_product_accepted',
  nextStageAuthorized: false,
  schemaVersion: 28,
  engineeringPassed: true,
  artifact,
  binarySha256: sha(binary),
  binaryBytes: binary.length,
  rustPassed,
  frontendFiles,
  frontendPassed,
  e2ePassed: 37,
  modelQuality: { realModelEvaluatedInM8: false, fixtureIsModelQualityEvidence: false },
  coverageScope: 'Existing configured subset, not whole-repository coverage',
  desktop,
  evidence,
};
await fs.writeFile('docs/V2.X/M8_DELIVERY_SNAPSHOT.json', JSON.stringify(output, null, 2) + '\n');
console.log(
  `M8 verified: Rust ${rustPassed}, frontend ${frontendPassed}, browser E2E 37, real desktop passed. Awaiting M8 product acceptance.`
);
