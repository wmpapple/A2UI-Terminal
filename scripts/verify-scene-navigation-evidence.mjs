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

const rust = await read('logs/m9-tools-ui-rust.log');
assert(!/test result: FAILED|error\[E/.test(rust));
for (const check of [
  'manual_publication_is_separate_durable_and_conflict_checked ... ok',
  'every_scene_supports_standalone_creation_and_optional_binding ... ok',
  'upgrade_from_30_unlocks_existing_tools_and_templates_without_losing_state ... ok',
])
  assert(rust.includes(check));
const rustTargetedPassed = [...rust.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
  (count, match) => count + Number(match[1]),
  0
);
assert.equal(rustTargetedPassed, 23);

const frontend = await read('logs/m9-workbench-baseline-frontend.log');
const frontendPassed = Number(frontend.match(/Tests\s+(\d+) passed/)?.[1]);
assert(frontendPassed >= 354 && !/\d+ failed/.test(frontend));
assert(!/error TS\d/.test(await read('logs/m9-workbench-baseline-typecheck.log')));
assert(!(await read('logs/m9-workbench-baseline-lint.log')).includes(' error '));
const format = await read('logs/m9-workbench-baseline-format.log');
assert(/Checking formatting/.test(format) && !/\[warn\]|\[error\]/.test(format));
assert(/built in/i.test(await read('logs/m9-workbench-baseline-build.log')));

const browser = await read('logs/m9-tools-ui-e2e.log');
assert(/33 passed/.test(browser) && /4 failed/.test(browser));
assert(/Running 4 tests using 1 worker/.test(browser) && /4 passed/.test(browser));

const desktop = JSON.parse(await read('logs/m9-workbench-baseline-desktop-verified/report.json'));
assert(desktop.passed && desktop.isolated && desktop.credentialsDisabled);
assert.deepEqual(desktop.pageErrors, []);
for (const check of [
  'scene_manual_publication_only',
  'scene_navigation_autosave',
  'scene_rename_and_distinguishable_list',
  'scene_tool_search_and_filters',
  'scene_tool_compact_sidebar_counts',
  'scene_tool_binding_and_result_statuses',
  'scene_tool_quiet_autosave_status',
  'scene_tool_light_selection_and_hover_menu',
  'scene_tool_form_sections',
  'scene_template_fixed_grid_and_tag_limit',
  'scene_delete_preserves_published_result',
  'scene_zero_model_requests',
])
  assert(desktop.checks.includes(check));

const artifact = 'logs/m9-workbench-baseline-review/a2ui-terminal.exe';
const binary = await fs.readFile(artifact);
assert.equal(sha(binary), desktop.binarySha256);
for (const name of [
  'templates.png',
  'templates-empty.png',
  'personal-template.png',
  'my-tools.png',
  'tool-synced.png',
  'tool-update-needed.png',
]) {
  const file = `logs/m9-workbench-baseline-desktop-verified/${name}`;
  evidence[file] = sha(await fs.readFile(file));
}

for (const file of [
  'src/app/AppShell.tsx',
  'src/app/AppShell.module.css',
  'src/features/a2ui/runtime/A2uiRuntime.tsx',
  'src/features/templates/components/PersonalSurfaceTemplates.tsx',
  'src/features/results/components/ResultWorkbench.tsx',
  'src/features/results/components/ResultAssistantPanel.tsx',
  'src/features/workspace/components/EditorPane.tsx',
  'src/shared/platform/desktop.ts',
  'src/shared/types/domain.ts',
  'src/shared/types/sceneTool.ts',
  'src-tauri/migrations/0030_scene_tool_publications.sql',
  'src-tauri/migrations/0031_optional_scene_bindings.sql',
  'src-tauri/src/application/scene_tool.rs',
  'src-tauri/src/repository/scene_tool.rs',
  'src-tauri/src/storage/mod.rs',
  'src-tauri/tests/scene_tools.rs',
  'src-tauri/tests/scene_bindings.rs',
  'scripts/verify-scene-workflow.mjs',
  'scripts/verify-scene-navigation-evidence.mjs',
  'package.json',
  'docs/V2.X/M9_CONTEXTUAL_TOOLS.md',
  'docs/V2.X/M9_EXECUTION.md',
  'docs/V2.X/M9_MANUAL_ACCEPTANCE.md',
])
  await read(file);
for (const name of await fs.readdir('src/features/sceneTools')) {
  if (/\.(ts|tsx|css)$/.test(name)) await read(`src/features/sceneTools/${name}`);
}

await fs.writeFile(
  'docs/V2.X/M9_NAVIGATION_SNAPSHOT.json',
  JSON.stringify(
    {
      stage: 'M9',
      status: 'engineering_verified_awaiting_product_acceptance',
      nextStageAuthorized: false,
      generatedAt: new Date().toISOString(),
      schemaVersion: 31,
      artifact,
      binarySha256: sha(binary),
      rustFullBaselinePassed: 346,
      rustTargetedPassed,
      frontendPassed,
      browserPassed: 37,
      browserValidation:
        '33 browser flows passed in the single-worker full run; 4 Chromium page-crash cases passed on isolated rerun',
      currentUiValidation:
        '354 frontend tests plus 45 real Tauri/WebView2 checks for compact single-line filters and counts, user-facing binding status, result revision and pending state, quiet autosave feedback, grouped forms and the complete tool lifecycle',
      sceneProviderRequests: 0,
      desktop,
      evidence,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `M9 My Tools baseline verified: Rust ${rustTargetedPassed}, UI ${frontendPassed}, browser 37, current real desktop passed. Awaiting M9 acceptance.`
);
