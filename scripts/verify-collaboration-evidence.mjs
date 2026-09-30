import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
const evidence = {};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function read(file) {
  const bytes = await fs.readFile(file);
  evidence[file] = sha(bytes);
  return bytes.toString(bytes[0] === 0xff ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
}
const rust = await read('logs/m10-rust-tests.log');
assert(!/test result: FAILED|error\[E|could not compile/.test(rust));
const rustPassed = [...rust.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
  (sum, m) => sum + Number(m[1]),
  0
);
assert(rustPassed >= 350);
for (const name of [
  'two_installations_roundtrip_requires_accept_and_supports_undo',
  'revocation_blocks_import_export_proposal_and_pending_apply',
  'migration_backfills_ownership_without_changing_existing_results',
  'stale_revision_even_identical_text_and_unsaved_drafts_block_apply',
])
  assert(rust.includes(`${name} ... ok`));
const frontend = await read('logs/m10-frontend-tests.log');
const frontendPassed = Number(frontend.match(/Tests\s+(\d+) passed/)?.[1]);
assert(frontendPassed >= 360 && !/\d+ failed/.test(frontend));
const browser = await read('logs/m10-e2e.log');
assert(/37 passed/.test(browser) && !/\d+ failed/.test(browser));
assert(!/error TS\d/.test(await read('logs/m10-typecheck.log')));
assert(!(await read('logs/m10-lint.log')).includes(' error '));
const format = await read('logs/m10-format-check.log');
assert(
  format.includes('All matched files use Prettier code style!') &&
    !/\[warn\]|\[error\]/.test(format)
);
const clippy = await read('logs/m10-clippy.log');
assert(/Finished/.test(clippy) && !/^error/m.test(clippy));
assert(/built in/.test(await read('logs/m10-build.log')));
const desktop = JSON.parse(await read('logs/m10-desktop/report.json'));
assert(desktop.passed && desktop.isolated && desktop.credentialsDisabled);
assert.deepEqual(desktop.pageErrors, []);
for (const check of [
  'collaboration_native_export',
  'collaboration_native_import',
  'collaboration_feedback_roundtrip',
  'collaboration_explicit_accept',
  'collaboration_undo',
  'collaboration_stale_feedback_guidance',
  'collaboration_reload',
  'collaboration_revoke',
  'collaboration_no_ai_requests',
  'collaboration_package_scope',
])
  assert(desktop.checks.includes(check));
const artifact = 'logs/m10-collaboration-review/a2ui-terminal.exe';
const binary = await fs.readFile(artifact);
assert.equal(sha(binary), desktop.binarySha256);
for (const file of [
  'src-tauri/src/application/collaboration.rs',
  'src-tauri/src/repository/collaboration.rs',
  'src-tauri/src/domain/collaboration.rs',
  'src-tauri/src/collaboration_commands.rs',
  'src-tauri/src/application/review.rs',
  'src-tauri/src/storage/mod.rs',
  'src-tauri/migrations/0032_local_collaboration.sql',
  'src-tauri/src/lib.rs',
  'src-tauri/build.rs',
  'src-tauri/capabilities/main.json',
  'src-tauri/tests/collaboration.rs',
  'src-tauri/tests/contract_fixtures.rs',
  'src-tauri/tests/scene_bindings.rs',
  'contracts/v2/collaboration.json',
  'src/shared/platform/desktop.ts',
  'src/shared/types/collaboration.ts',
  'src/features/results/components/ResultsPage.tsx',
  'src/features/results/components/ResultWorkbench.tsx',
  'scripts/select-collaboration-file.ps1',
  'scripts/verify-collaboration-workflow.mjs',
  'scripts/verify-product-beta-desktop.mjs',
  'scripts/verify-collaboration-evidence.mjs',
  'package.json',
  'docs/V2.X/M10_COLLABORATION_ADR.md',
  'docs/V2.X/M10_EXECUTION.md',
  'docs/V2.X/M10_MANUAL_ACCEPTANCE.md',
  'docs/V2.X/V2X_IMPLEMENTATION_PLAN.md',
])
  await read(file);
evidence['logs/m10-desktop/collaboration-roundtrip.png'] = sha(
  await fs.readFile('logs/m10-desktop/collaboration-roundtrip.png')
);
for (const file of await fs.readdir('src/features/collaboration'))
  await read(`src/features/collaboration/${file}`);
await fs.writeFile(
  'docs/V2.X/M10_ENGINEERING_SNAPSHOT.json',
  JSON.stringify(
    {
      stage: 'M10_local_collaboration',
      status: 'engineering_verified_awaiting_product_acceptance',
      nextStageAuthorized: false,
      generatedAt: new Date().toISOString(),
      schemaVersion: 32,
      artifact,
      binarySha256: sha(binary),
      rustPassed,
      frontendPassed,
      browserPassed: 37,
      collaborationModelRequests: 0,
      desktop,
      evidence,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `M10 verified: Rust ${rustPassed}, frontend ${frontendPassed}, browser 37, desktop ${desktop.checks.length}. Awaiting product acceptance.`
);
