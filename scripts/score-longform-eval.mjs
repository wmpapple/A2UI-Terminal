import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const fixtureBytes = await fs.readFile('evals/longform/cases.json');
const fixture = JSON.parse(fixtureBytes);
const run = JSON.parse(await fs.readFile('logs/m6-model/results.json', 'utf8'));
const model = JSON.parse(await fs.readFile('logs/m6-model/ready.json', 'utf8'));
assert.equal(run.fixtureVersion, fixture.version);
assert.equal(run.promptVersion, fixture.promptVersion);
assert.equal(run.cases.length, fixture.cases.length);
const scores = run.cases.map((entry, index) => {
  const complete =
    entry.chapters.length === fixture.cases[index].sections.length &&
    entry.chapters.every((c) => c.status === 'review');
  const text = entry.chapters.map((c) => c.content).join('\n\n');
  const compact = text.replace(/\s/g, '');
  const retained =
    [
      compact.includes('420'),
      compact.includes('尚未批准') || compact.includes('未获批准'),
      /2026年10月15日|2026-10-15/.test(compact),
    ].filter(Boolean).length / 3;
  const unknownKeys = entry.chapters.flatMap((c) => {
    const allowed = new Set(c.snapshot.manifest.citations.map((s) => s.key));
    return [...c.content.matchAll(/\[(S\d+)\]/g)]
      .map((m) => m[1])
      .filter((key) => !allowed.has(key));
  });
  const coverage =
    entry.chapters.filter((c) => /\[S\d+\]/.test(c.content)).length /
    fixture.cases[index].sections.length;
  const paragraphs = entry.chapters.flatMap((c) =>
    c.content
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\[S\d+\]|\s/g, ''))
      .filter((p) => p.length >= 30)
  );
  const repeated = paragraphs.length
    ? (paragraphs.length - new Set(paragraphs).size) / paragraphs.length
    : 0;
  // These are screening flags, not entailment judgments. Manual review separately
  // checks qualifiers, suggestions, citation support and cross-chapter consistency.
  const approvalFlags = (text.match(/已经批准|已获批准|审批已完成|预算已批准/g) ?? []).length;
  const terminologyFlags = (text.match(/星河工程/g) ?? []).length;
  const citationsVerified =
    Boolean(entry.result?.citations?.length) &&
    entry.result.citations.every((c) => c.status === 'verified');
  const automatedPassed =
    complete &&
    retained >= fixture.thresholds.criticalFactsRetained &&
    coverage >= fixture.thresholds.chaptersWithSourceCitation &&
    unknownKeys.length === 0 &&
    approvalFlags === 0 &&
    terminologyFlags === 0 &&
    text.length >= fixture.thresholds.minimumTotalCharacters &&
    repeated <= fixture.thresholds.maximumRepeatedParagraphRatio &&
    citationsVerified;
  return {
    id: entry.id,
    complete,
    characters: text.length,
    criticalFactsRetained: retained,
    chaptersWithSourceCitation: coverage,
    unknownKeys,
    approvalFlags,
    terminologyFlags,
    repeatedParagraphRatio: repeated,
    citationsVerified,
    automatedPassed,
    chapterMilliseconds: entry.chapters.map((c) => c.elapsedMs),
  };
});
const score = {
  fixtureVersion: fixture.version,
  fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  promptVersion: run.promptVersion,
  model,
  repetitions: 1,
  decoding: { doSample: false, maxNewTokens: 1800, thinking: false },
  automatedPassed: scores.every((s) => s.automatedPassed),
  manualReviewRequired: true,
  scores,
};
await fs.writeFile('logs/m6-model/scores.json', JSON.stringify(score, null, 2));
console.log(JSON.stringify(score, null, 2));
if (!score.automatedPassed) process.exitCode = 1;
