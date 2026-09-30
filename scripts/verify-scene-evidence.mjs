import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

const evidence = {};
const sha = (data) => createHash('sha256').update(data).digest('hex');
const read = async (file) => {
  const data = await fs.readFile(file);
  evidence[file] = sha(data);
  return data.toString(data[0] === 0xff ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
};
const log = (name) => read(`logs/m9-context-${name}.log`);
const rust = await log('rust-tests');
assert(rust.includes('Doc-tests a2ui_terminal_lib') && !/test result: FAILED|error\[E/.test(rust));
assert(rust.includes('scene_ipc_contract_matches_frontend_fixture ... ok'));
const rustPassed = [...rust.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
  (n, m) => n + Number(m[1]),
  0
);
assert(rustPassed >= 342);
const frontend = await log('frontend-tests');
const frontendFiles = Number(frontend.match(/Test Files\s+(\d+) passed/)?.[1]);
const frontendPassed = Number(frontend.match(/Tests\s+(\d+) passed/)?.[1]);
assert(frontendFiles >= 77 && frontendPassed >= 338 && !/\d+ failed/.test(frontend));
assert(/37 passed/.test(await log('e2e')));
assert(!/error TS\d/.test(await log('typecheck')));
assert(!/✖|error\s+/.test(await log('lint')));
assert(/All matched files use Prettier code style/.test(await log('format')));
assert(/Finished `dev`/.test(await log('clippy')));
assert(/Built application at:/.test(await log('desktop-build')));
assert.equal((await log('rustfmt')).trim(), '');
assert(/Third-party audit passed/.test(await log('licenses')));
assert(/Validated 40 fixed style evaluation cases/.test(await log('style-fixtures')));
assert(/Beta evidence verified/.test(await log('beta-evidence')));
assert(/UnsignedAcceptance/.test(await log('release-config')));
const desktop = JSON.parse(await read('logs/m9-context-desktop/report.json'));
assert(desktop.passed && desktop.isolated && desktop.credentialsDisabled);
assert.deepEqual(desktop.pageErrors, []);
for (const name of [
  'scene_five_templates',
  'scene_required_document_binding',
  'scene_result_binding_without_file',
  'scene_review_checkpoint',
  'scene_binding_context_separation',
  'scene_real_inputs',
  'scene_atomic_snapshot',
  'scene_pending_items_export',
  'scene_template_values_cleared',
  'scene_navigation_autosave',
  'scene_webview_reload',
  'scene_conflict_keeps_input',
  'scene_export_entry',
  'scene_zero_model_requests',
])
  assert(desktop.checks.includes(name));
const artifact = 'logs/m9-context-review/a2ui-terminal.exe';
const binary = await fs.readFile(artifact);
assert.equal(sha(binary), desktop.binarySha256);
for (const file of [
  'src-tauri/src/application/scene_tool.rs',
  'src-tauri/src/application/scene_link.rs',
  'src-tauri/src/repository/scene_link.rs',
  'src-tauri/migrations/0029_scene_tool_bindings.sql',
  'src-tauri/src/storage/mod.rs',
  'src-tauri/src/commands.rs',
  'src-tauri/src/lib.rs',
  'src-tauri/src/application/critic.rs',
  'src-tauri/tests/scene_bindings.rs',
  'src/features/sceneTools/BindingPicker.tsx',
  'src/features/sceneTools/ToolBindingPanel.tsx',
  'src/features/sceneTools/ToolBindingPanel.test.tsx',
  'src/features/sceneTools/BoundSceneTools.tsx',
  'src/features/results/components/ResultWorkbench.tsx',
  'src/features/workspace/components/EditorPane.tsx',
  'src/shared/platform/desktop.ts',
  'src-tauri/capabilities/main.json',
  'docs/V2.X/M9_CONTEXTUAL_TOOLS.md',
  'src-tauri/src/repository/scene_tool.rs',
  'src-tauri/src/a2ui/mod.rs',
  'src-tauri/src/application/result.rs',
  'src-tauri/src/application/export.rs',
  'src-tauri/tests/scene_tools.rs',
  'src/features/sceneTools/sceneToolStore.ts',
  'src/features/sceneTools/SceneToolWorkbench.tsx',
  'src/features/sceneTools/SceneTemplateCards.tsx',
  'src/features/sceneTools/SavedSceneTemplates.tsx',
  'src/features/sceneTools/sceneToolController.ts',
  'src/features/results/components/ResultAssistantPanel.tsx',
  'src/features/sceneTools/sceneToolStore.test.ts',
  'src/features/sceneTools/SceneTemplateCards.test.tsx',
  'src/shared/types/sceneTool.ts',
  'contracts/v2x/scene-tool.json',
  'scripts/verify-scene-workflow.mjs',
])
  evidence[file] = sha(await fs.readFile(file));
const output = {
  stage: 'M9',
  status: 'engineering_verified_awaiting_product_acceptance',
  generatedAt: new Date().toISOString(),
  baselineCommit: 'e7e6faa',
  previousStage: 'M8_product_accepted',
  nextStageAuthorized: false,
  schemaVersion: 29,
  supplement: 'contextual_tools',
  engineeringPassed: true,
  artifact,
  binarySha256: sha(binary),
  binaryBytes: binary.length,
  rustPassed,
  frontendFiles,
  frontendPassed,
  e2ePassed: 37,
  sceneProviderRequests: 0,
  modelQualityEvaluation: false,
  coverageScope: 'Existing configured subset, not whole-repository coverage',
  desktop,
  evidence,
};
await fs.writeFile('docs/V2.X/M9_DELIVERY_SNAPSHOT.json', JSON.stringify(output, null, 2) + '\n');
console.log(
  `M9 verified: Rust ${rustPassed}, frontend ${frontendPassed}, browser E2E 37, real desktop passed. Awaiting M9 product acceptance.`
);
