import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('./cases.jsonl', import.meta.url));
const lines = (await readFile(path, 'utf8'))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const cases = lines.map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
  }
});
if (cases.length < 40 || cases.length > 60)
  throw new Error('Style baseline must contain 40–60 cases.');
const ids = new Set();
for (const item of cases) {
  for (const key of [
    'id',
    'taskType',
    'input',
    'profileRule',
    'currentInstruction',
    'expectedFacts',
    'requiredTerms',
    'forbiddenTerms',
    'mustNotInvent',
  ]) {
    if (!(key in item)) throw new Error(`${item.id ?? 'unknown'} is missing ${key}`);
  }
  if (ids.has(item.id)) throw new Error(`Duplicate case id: ${item.id}`);
  ids.add(item.id);
  if (!Array.isArray(item.expectedFacts) || item.expectedFacts.length === 0)
    throw new Error(`${item.id} needs expected facts`);
  if (!Array.isArray(item.requiredTerms) || !Array.isArray(item.forbiddenTerms))
    throw new Error(`${item.id} has invalid term assertions`);
  if (item.mustNotInvent !== true) throw new Error(`${item.id} must keep the no-invention guard`);
}
process.stdout.write(
  `Validated ${cases.length} fixed style evaluation cases. No provider was called.\n`
);
