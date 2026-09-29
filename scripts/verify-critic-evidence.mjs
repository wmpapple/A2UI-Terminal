import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const evidence = {};
async function readLog(name) {
  const file = `logs/m7-${name}.log`,
    bytes = await fs.readFile(file);
  evidence[file] = sha(bytes);
  return bytes.toString(bytes[0] === 0xff ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
}
const rust = await readLog('rust-tests');
assert(!rust.includes('test result: FAILED') && /Doc-tests a2ui_terminal_lib/.test(rust));
const rustPassed = [...rust.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
  (sum, m) => sum + Number(m[1]),
  0
);
const rustIgnored = [
  ...rust.matchAll(/test result: ok\. \d+ passed; \d+ failed; (\d+) ignored/g),
].reduce((sum, m) => sum + Number(m[1]), 0);
assert.equal(rustPassed, 310);
assert.equal(rustIgnored, 3);
const frontend = await readLog('frontend-tests');
assert(/Test Files\s+70 passed/.test(frontend) && /Tests\s+310 passed/.test(frontend));
const e2e = await readLog('e2e');
assert(/Tests\s+6 passed/.test(await readLog('ui-targeted')));
assert(/37 passed/.test(e2e) && !/\d+ failed/.test(e2e));
assert(!/error TS\d/.test(await readLog('typecheck')));
assert(!/✖|error\s+/.test(await readLog('lint')));
assert(/All matched files use Prettier code style/.test(await readLog('format')));
assert(/Finished `dev`/.test(await readLog('clippy')));
assert(/Built application at:/.test(await readLog('desktop-build')));
const desktopBytes = await fs.readFile('logs/m7-desktop/report.json');
evidence['logs/m7-desktop/report.json'] = sha(desktopBytes);
const desktop = JSON.parse(desktopBytes);
assert(desktop.passed && desktop.isolated && desktop.credentialsDisabled);
assert.deepEqual(desktop.pageErrors, []);
for (const check of [
  'critic_local_zero_requests',
  'critic_ignored_restart',
  'critic_explicit_consent',
  'critic_read_only',
  'critic_located_passage',
  'critic_inline_review_apply',
  'critic_old_revision_rejected',
  'critic_saved_history',
])
  assert(desktop.checks.includes(check));
const artifact = 'logs/m7-critic-review/a2ui-terminal.exe';
const bytes = await fs.readFile(artifact);
assert.equal(sha(bytes), desktop.binarySha256);
for (const file of [
  'src-tauri/src/application/critic.rs',
  'src-tauri/src/domain/critic.rs',
  'src-tauri/src/repository/critic.rs',
  'src-tauri/src/repository/document.rs',
  'src-tauri/src/workspace/mod.rs',
  'src-tauri/migrations/0027_critic.sql',
  'src-tauri/tests/critic.rs',
  'src-tauri/tests/citations.rs',
  'src-tauri/tests/workspace_result_boundary.rs',
  'src/features/critic/CriticPanel.tsx',
  'src/features/critic/CriticPanel.test.tsx',
  'src/features/workspace/workspaceStore.ts',
  'src/stores/desktopWorkspace.test.ts',
  'e2e/critic.spec.ts',
  'scripts/verify-critic-workflow.mjs',
])
  evidence[file] = sha(await fs.readFile(file));
const output = {
  stage: 'M7',
  status: 'engineering_verified_awaiting_product_acceptance',
  generatedAt: new Date().toISOString(),
  baselineCommit: '91f9244',
  previousStage: 'M6_product_accepted',
  nextStageAuthorized: false,
  schemaVersion: 27,
  engineeringPassed: true,
  artifact,
  binarySha256: sha(bytes),
  binaryBytes: bytes.length,
  rustPassed,
  rustIgnored,
  frontendPassed: 310,
  frontendFiles: 70,
  e2ePassed: 37,
  modelQuality: {
    qualifiedModels: [],
    realModelEvaluatedInM7: false,
    fixtureIsModelQualityEvidence: false,
    outputRequiresHumanReview: true,
  },
  coverageScope:
    'Existing configured chat buffer/context snapshot subset; not whole-repository coverage',
  desktop,
  evidence,
};
await fs.writeFile('docs/V2.X/M7_DELIVERY_SNAPSHOT.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(
  'M7 evidence verified. Engineering passed; no model accuracy certification; awaiting product acceptance.'
);
