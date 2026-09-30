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
const log = (name) => read(`logs/m9-standalone-${name}.log`);
const rust = await log('rust');
assert(rust.includes('Doc-tests a2ui_terminal_lib') && !/test result: FAILED|error\[E/.test(rust));
assert(rust.includes('manual_publication_is_separate_durable_and_conflict_checked ... ok'));
assert(rust.includes('every_scene_supports_standalone_creation_and_optional_binding ... ok'));
assert(
  rust.includes('upgrade_from_30_unlocks_existing_tools_and_templates_without_losing_state ... ok')
);
const rustPassed = [...rust.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
  (n, m) => n + Number(m[1]),
  0
);
const ui = await log('ui');
const frontendPassed = Number(ui.match(/Tests\s+(\d+) passed/)?.[1]);
assert(frontendPassed >= 342 && !/\d+ failed/.test(ui));
assert(/37 passed/.test(await read('logs/m9-manual-results-e2e.log')));
assert(!/error TS\d/.test(await log('typecheck')));
assert(!/✖|error\s+/.test(await log('lint')));
assert(/All matched files use Prettier code style/.test(await log('format-check')));
assert(/Finished `dev`/.test(await log('clippy')));
assert(/Built application at:/.test(await log('build')));
const desktop = JSON.parse(await read('logs/m9-standalone-desktop/report.json'));
assert(desktop.passed && desktop.isolated && desktop.credentialsDisabled);
assert.deepEqual(desktop.pageErrors, []);
for (const check of [
  'scene_all_templates_standalone',
  'scene_optional_binding_and_unlink',
  'scene_personal_template_standalone',
  'scene_manual_publication_only',
  'scene_snapshot_isolation',
  'scene_explicit_update_same_result',
  'scene_snapshot_readonly_route',
  'scene_my_tools_reopen',
  'scene_zero_model_requests',
])
  assert(desktop.checks.includes(check));
const artifact = 'logs/m9-standalone-review/a2ui-terminal.exe';
const binary = await fs.readFile(artifact);
assert.equal(sha(binary), desktop.binarySha256);
for (const file of [
  'src-tauri/migrations/0030_scene_tool_publications.sql',
  'src-tauri/migrations/0031_optional_scene_bindings.sql',
  'src-tauri/src/repository/scene_tool.rs',
  'src-tauri/src/application/scene_tool.rs',
  'src-tauri/src/storage/mod.rs',
  'src-tauri/src/commands.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/build.rs',
  'src-tauri/capabilities/main.json',
  'src-tauri/tests/scene_tools.rs',
  'src-tauri/tests/scene_bindings.rs',
  'src/shared/platform/desktop.ts',
  'src/shared/types/sceneTool.ts',
  'src/features/results/components/ResultWorkbench.tsx',
  'src/features/results/components/ResultAssistantPanel.tsx',
  'src/features/templates/components/PersonalSurfaceTemplates.tsx',
  'scripts/verify-scene-workflow.mjs',
  'scripts/verify-scene-standalone-evidence.mjs',
  'docs/V2.X/M9_CONTEXTUAL_TOOLS.md',
  'docs/V2.X/M9_MANUAL_ACCEPTANCE.md',
])
  await read(file);
for (const name of await fs.readdir('src/features/sceneTools')) {
  if (/\.(ts|tsx|css)$/.test(name)) await read(`src/features/sceneTools/${name}`);
}
await fs.writeFile(
  'docs/V2.X/M9_STANDALONE_SNAPSHOT.json',
  JSON.stringify(
    {
      stage: 'M9',
      status: 'engineering_verified_awaiting_product_acceptance',
      nextStageAuthorized: false,
      generatedAt: new Date().toISOString(),
      schemaVersion: 31,
      artifact,
      binarySha256: sha(binary),
      rustPassed,
      frontendPassed,
      browserBaselinePassed: 37,
      sceneProviderRequests: 0,
      desktop,
      evidence,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `Manual scene publication verified: Rust ${rustPassed}, UI ${frontendPassed}, browser baseline 37, current real desktop passed. Awaiting M9 acceptance.`
);
