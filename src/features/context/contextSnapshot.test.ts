import { describe, expect, it } from 'vitest';
import {
  buildContextSnapshot,
  contextReviewFingerprint,
  isSensitivePath,
  requiresContextReview,
} from './contextSnapshot';

describe('context snapshot', () => {
  it('contains only explicitly selected sources', () => {
    const snapshot = buildContextSnapshot({
      selection: {
        selection: false,
        currentFile: true,
        recentMessages: false,
        recentMessageCount: 3,
        projectFiles: [],
      },
      files: [
        { path: 'a.ts', name: 'a.ts', language: 'ts', content: 'included' },
        { path: 'b.ts', name: 'b.ts', language: 'ts', content: 'not selected' },
      ],
      activePath: 'a.ts',
      selectedText: '',
      recentMessages: [],
      prompt: 'explain',
    });
    expect(snapshot.sources.map((source) => source.label)).toEqual(['a.ts']);
    expect(snapshot.sources[0].content).not.toContain('not selected');
  });

  it('excludes common secret paths by default', () => {
    expect(isSensitivePath('.env.production')).toBe(true);
    expect(isSensitivePath('secrets/token.txt')).toBe(true);
    expect(isSensitivePath('src/config.ts')).toBe(false);
  });

  it('reuses confirmation until selected file context changes', () => {
    const input = {
      selection: {
        selection: false,
        currentFile: true,
        recentMessages: true,
        recentMessageCount: 3,
        projectFiles: [],
      },
      files: [{ path: 'a.ts', name: 'a.ts', language: 'ts', content: 'version one' }],
      activePath: 'a.ts',
      selectedText: '',
    };
    const reviewed = contextReviewFingerprint(input);

    expect(requiresContextReview(reviewed, contextReviewFingerprint(input), [])).toBe(false);
    expect(
      requiresContextReview(
        reviewed,
        contextReviewFingerprint({
          ...input,
          files: [{ ...input.files[0], content: 'version two' }],
        }),
        []
      )
    ).toBe(true);
  });

  it('always requires confirmation for possible secrets', () => {
    expect(requiresContextReview('same', 'same', ['message: possible secret'])).toBe(true);
  });
});
