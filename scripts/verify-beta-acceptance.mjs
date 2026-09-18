import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'contracts/v2/beta-acceptance.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const failures = [];

const fail = (message) => failures.push(message);
const exactSet = (values, expected, label) => {
  const actual = [...new Set(values)].sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label}: expected ${wanted.join(', ')}, got ${actual.join(', ')}`);
  }
};

const verifyEvidence = (owner, evidence) => {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    fail(`${owner}: no evidence references`);
    return;
  }
  for (const reference of evidence) {
    if (!reference?.path || !reference?.contains) {
      fail(`${owner}: evidence must include path and contains`);
      continue;
    }
    let text;
    try {
      text = readFileSync(resolve(root, reference.path), 'utf8');
    } catch {
      fail(`${owner}: missing evidence file ${reference.path}`);
      continue;
    }
    if (!text.includes(reference.contains)) {
      fail(`${owner}: ${reference.path} does not contain ${JSON.stringify(reference.contains)}`);
    }
  }
};

if (manifest.schemaVersion !== 1 || manifest.stage !== 'S4.7') {
  fail('manifest identity must be schemaVersion 1 for S4.7');
}
if (
  manifest.source?.prdSha256 !== 'E56FD2303B6228C5FC7AB1936FB1C2B71229845D6780DFDA2ACE06D69347AA3C'
) {
  fail('the pinned PRD SHA-256 is missing or changed');
}
if (manifest.source?.originalAvailableAtExecution !== false) {
  fail('the manifest must not claim the unavailable original PRD was re-read');
}

if (manifest.targetProfiles?.length !== 4) fail('exactly four target profiles are required');
for (const profile of manifest.targetProfiles ?? []) {
  verifyEvidence(`target profile ${profile.id}`, profile.evidence);
}

exactSet(
  manifest.p0Templates ?? [],
  ['meeting_minutes', 'document_summary', 'weekly_report', 'resume_optimization'],
  'P0 templates'
);
exactSet(
  (manifest.resultTypes ?? []).map(({ id }) => id),
  ['document', 'spreadsheet', 'checklist', 'form', 'tool'],
  'Result types'
);
for (const resultType of manifest.resultTypes ?? []) {
  verifyEvidence(`Result type ${resultType.id}`, resultType.evidence);
}

if ((manifest.highFrequencyScenarios ?? []).length < 2) {
  fail('at least two high-frequency scenarios are required');
}
for (const scenario of manifest.highFrequencyScenarios ?? []) {
  if (!scenario.completion || !scenario.save || !scenario.export) {
    fail(`${scenario.id}: completion, save, and export evidence are all required`);
  }
  if (scenario.firstEffectiveResultBudgetMs !== 90_000) {
    fail(`${scenario.id}: first effective Result budget must be 90000 ms`);
  }
  verifyEvidence(`high-frequency scenario ${scenario.id}`, scenario.evidence);
}

const criteria = manifest.section12_3Criteria ?? [];
exactSet(
  criteria.map(({ id }) => id),
  Array.from({ length: 8 }, (_, index) => `BETA-12.3-0${index + 1}`),
  'Section 12.3 criteria'
);
for (const criterion of criteria) {
  if (!['automated', 'manual', 'automated_and_manual'].includes(criterion.mode)) {
    fail(`${criterion.id}: unsupported evidence mode`);
  }
  verifyEvidence(criterion.id, criterion.evidence);
}

exactSet(
  (manifest.p0Traceability ?? []).map(({ requirement }) => requirement),
  [
    'ONB-01',
    'HOME-01/02',
    'IMP-01/02',
    'TASK-01/02',
    'WS-01/02/03/04',
    'CTX-01/02/03',
    'CTX-05',
    'REV-01…04/06',
    'OUT-01…04',
    'EXP-01/02/03',
    'RES-01',
    'SEL-01',
    'PRV-04',
    'ARC-03',
    'A2UI-06',
  ],
  'P0 traceability requirements'
);
for (const item of manifest.p0Traceability ?? []) {
  verifyEvidence(`P0 ${item.requirement}`, item.evidence);
}

if ((manifest.releaseBoundaries ?? []).length < 3) {
  fail('S4.7/S4.8 and open-service boundaries must be explicit');
}

if (failures.length > 0) {
  console.error('S4.7 Beta evidence verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `S4.7 Beta evidence verified: ${manifest.targetProfiles.length} profiles, ${manifest.p0Templates.length} templates, ${manifest.resultTypes.length} Result types, ${criteria.length} section 12.3 criteria, ${manifest.p0Traceability.length} P0 requirement groups.`
  );
}
