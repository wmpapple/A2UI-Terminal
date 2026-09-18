import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const notice = readFileSync(resolve(root, 'src-tauri', 'THIRD_PARTY_NOTICES.md'), 'utf8');
const cargoLock = readFileSync(resolve(root, 'src-tauri', 'Cargo.lock'), 'utf8');

function fail(message) {
  throw new Error(`third-party audit failed: ${message}`);
}

const productionNpmPackages = Object.entries(packageLock.packages)
  .filter(([path, metadata]) => path.startsWith('node_modules/') && !metadata.dev)
  .map(([path, metadata]) => ({ path, ...metadata }));
for (const dependency of productionNpmPackages) {
  if (!dependency.version || !dependency.license) {
    fail(`${dependency.path} is missing a locked version or license`);
  }
  if (dependency.resolved && !dependency.integrity) {
    fail(`${dependency.path} is missing package-lock integrity`);
  }
}
for (const name of Object.keys(packageJson.dependencies)) {
  const dependency = packageLock.packages[`node_modules/${name}`];
  if (!dependency) fail(`direct npm dependency ${name} is absent from package-lock.json`);
  if (!notice.includes(`${name} ${dependency.version}`)) {
    fail(`direct npm dependency ${name} ${dependency.version} is absent from the notice`);
  }
}

for (const block of cargoLock.split('[[package]]').slice(1)) {
  if (block.includes('source = "registry+') && !block.includes('\nchecksum = "')) {
    const name = block.match(/\nname = "([^"]+)"/)?.[1] ?? 'unknown crate';
    fail(`${name} is missing a Cargo.lock checksum`);
  }
}

const cargo = spawnSync(
  'cargo',
  [
    'metadata',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--locked',
    '--offline',
    '--filter-platform',
    'x86_64-pc-windows-msvc',
    '--format-version',
    '1',
  ],
  {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 24 * 1024 * 1024,
    env: { ...process.env, RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? 'stable' },
  }
);
if (cargo.status !== 0) fail(cargo.stderr.trim() || 'cargo metadata did not complete');
const metadata = JSON.parse(cargo.stdout);
const externalCrates = metadata.packages.filter((dependency) => dependency.source);
for (const dependency of externalCrates) {
  if (!dependency.license && !dependency.license_file) {
    fail(`${dependency.name} ${dependency.version} has no license metadata`);
  }
}
const application = metadata.packages.find((dependency) => dependency.name === 'a2ui-terminal');
const applicationNode = metadata.resolve.nodes.find((node) => node.id === application.id);
const directRustPackages = applicationNode.deps
  .filter((dependency) => dependency.dep_kinds.some((kind) => kind.kind === null))
  .map((dependency) => metadata.packages.find((candidate) => candidate.id === dependency.pkg));
for (const dependency of directRustPackages) {
  if (!notice.includes(`${dependency.name} ${dependency.version}`)) {
    fail(
      `direct Rust dependency ${dependency.name} ${dependency.version} is absent from the notice`
    );
  }
}

const upstreamCommit = '981e82f1a3cef88456416fa6fd80d8490964df01';
if (!notice.includes(upstreamCommit) || !notice.includes('Apache-2.0')) {
  fail('the reused A2UI source commit and Apache-2.0 license are not recorded');
}
if (!notice.includes('D68BAFCB48A2707749396AA12BBBD833CB70401F3A9A689FD2902C7E0D295964')) {
  fail('the bundled font hash is not recorded');
}

console.log(
  `Third-party audit passed: ${productionNpmPackages.length} production npm packages and ${externalCrates.length} Windows Rust packages have license metadata; direct dependencies and reused-source provenance are present in the bundled notice.`
);
