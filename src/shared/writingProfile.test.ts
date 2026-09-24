import { expect, it } from 'vitest';
import type { WritingProfileSnapshot } from './types/domain';
import { formatWritingProfileForDisplay } from './writingProfile';

const snapshot: WritingProfileSnapshot = {
  hash: 'hash',
  composerVersion: 'm2.1',
  enabled: true,
  layers: [{ id: 'global', scope: 'global', version: 3, rules: '先给结论' }],
  terminology: [{ term: 'AI', preferred: 'AI 助手' }],
  forbiddenWords: ['赋能'],
  exampleKnowledgeIds: [],
  instructionText:
    'Global Profile:\n- Rules: 先给结论\n- Preferred terminology:\n  - AI => AI 助手',
  estimatedTokens: 20,
};

it('formats the structured writing profile entirely in Chinese for the Chinese interface', () => {
  const output = formatWritingProfileForDisplay(snapshot, 'zh-CN');

  expect(output).toContain('全局偏好：');
  expect(output).toContain('- 写作规则：先给结论');
  expect(output).toContain('- 推荐术语：');
  expect(output).toContain('AI → AI 助手');
  expect(output).toContain('- 避免使用：赋能');
  expect(output).not.toMatch(/Global Profile|Rules:|Preferred terminology|Avoid these words|v3/);
});

it('keeps the English profile labels in the English interface', () => {
  const output = formatWritingProfileForDisplay(snapshot, 'en-US');

  expect(output).toContain('Global Profile:');
  expect(output).toContain('- Rules: 先给结论');
  expect(output).toContain('- Preferred terminology:');
  expect(output).toContain('AI => AI 助手');
});
