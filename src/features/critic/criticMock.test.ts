import { afterEach, expect, it } from 'vitest';
import { criticMock } from './criticMock';
import { writingProfileController } from '../settings/writingProfileController';
import type { DocumentSnapshot } from '../../shared/types/document';

afterEach(async () => {
  await writingProfileController.delete('global');
  await writingProfileController.delete('workspace', 'test-workspace');
  localStorage.clear();
});

it.each(['global', 'workspace'] as const)(
  'checks saved %s forbidden words and invalidates changed rules',
  async (scope) => {
    await writingProfileController.save({
      scope,
      workspaceId: scope === 'workspace' ? 'test-workspace' : null,
      enabled: true,
      rules: '',
      terminology: [],
      forbiddenWords: ['赋能'],
      exampleKnowledgeIds: [],
    });
    const snapshot: DocumentSnapshot = {
      target: { kind: 'result', resultId: 'test-result' },
      revisionId: 'r1',
      contentHash: 'hash',
      text: '# 🙂赋能\n\n赋能团队。赋能。\n\n`赋能`\n\n```txt\n赋能\n```',
      format: 'markdown',
      editable: true,
      hasUnsavedDraft: false,
    };
    const options = { sentenceLimit: 120, paragraphLimit: 400 };
    const { local } = await criticMock.inspect(snapshot, options, 'test-workspace');
    const words = local.findings.filter((f) => f.kind === 'forbidden_word');
    expect(words).toHaveLength(3);
    for (const word of words) expect(snapshot.text.slice(word.start, word.end)).toBe('赋能');
    await criticMock.ignore(local.id, words[0].id, true);
    expect(
      (await criticMock.inspect(snapshot, options, 'test-workspace')).local.findings[0].ignored
    ).toBe(true);
    await writingProfileController.delete(scope, 'test-workspace');
    expect(
      (await criticMock.inspect(snapshot, options, 'test-workspace')).local.findings.some(
        (f) => f.kind === 'forbidden_word'
      )
    ).toBe(false);
  }
);
