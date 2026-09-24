import { beforeEach, describe, expect, it } from 'vitest';
import fixture from '../../../contracts/v2/context-manifest.json';
import type { ContextManifest } from '../../shared/types/domain';
import type { GenerationPlan } from '../../shared/types/generation';
import {
  approvedSensitiveConfirmation,
  clearGenerationSessionsForTests,
  readGenerationSession,
  rememberGenerationScope,
  writeGenerationSession,
} from './generationSession';

const plan = (
  prompt: string,
  contentHash = 'a'.repeat(64),
  profileHash = 'profile-disabled-contract'
): GenerationPlan => ({
  id: crypto.randomUUID(),
  requestId: crypto.randomUUID(),
  targetTitle: '成果',
  prompt,
  manifest: {
    ...fixture,
    writingProfile: { ...fixture.writingProfile, hash: profileHash },
    includedSources: fixture.includedSources.map((source) => ({ ...source, contentHash })),
    requiresSensitiveConfirmation: false,
  } as ContextManifest,
});

describe('generation session approval', () => {
  beforeEach(clearGenerationSessionsForTests);

  it('reuses approval for a changed instruction only while provider and sent sources stay equal', () => {
    rememberGenerationScope('result:1', plan('第一次'), 'provider-v1', false);

    expect(approvedSensitiveConfirmation('result:1', plan('继续总结'), 'provider-v1')).toBe(false);
    expect(
      approvedSensitiveConfirmation('result:1', plan('继续总结', 'b'.repeat(64)), 'provider-v1')
    ).toBeNull();
    expect(approvedSensitiveConfirmation('result:1', plan('继续总结'), 'provider-v2')).toBeNull();
    expect(
      approvedSensitiveConfirmation(
        'result:1',
        plan('继续总结', 'a'.repeat(64), 'changed-profile'),
        'provider-v1'
      )
    ).toBeNull();
  });

  it('keeps an isolated in-memory draft for navigation remounts', () => {
    writeGenerationSession('result:1', {
      prompt: '尚未发送的要求',
      knowledgeIds: ['knowledge'],
      documentIds: ['document'],
      packIds: ['pack'],
      includeResult: true,
      sentPlan: null,
      text: '',
      applied: null,
    });
    const restored = readGenerationSession('result:1');
    expect(restored).toMatchObject({ prompt: '尚未发送的要求', includeResult: true });
    restored?.documentIds.push('mutated');
    expect(readGenerationSession('result:1')?.documentIds).toEqual(['document']);
  });
});
