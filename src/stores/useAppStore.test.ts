import { beforeEach, describe, expect, it } from 'vitest';
import { mockFiles, mockSessions } from '../shared/mock/workspace';
import { useAppStore } from './useAppStore';

beforeEach(() => {
  useAppStore.setState({
    files: mockFiles,
    openPaths: ['README.md'],
    activePath: 'README.md',
    dirtyPaths: [],
    centerView: 'editor',
    sessions: mockSessions,
    activeSessionId: 'welcome',
    pendingDiff: null,
  });
});

describe('workspace review flow', () => {
  it('creates a review proposal without mutating the document', () => {
    const before = useAppStore.getState().files[0].content;
    useAppStore.getState().createProposal();
    expect(useAppStore.getState().pendingDiff).not.toBeNull();
    expect(useAppStore.getState().files[0].content).toBe(before);
    expect(useAppStore.getState().centerView).toBe('diff');
  });

  it('applies an accepted proposal and marks the file dirty', () => {
    useAppStore.getState().createProposal();
    useAppStore.getState().applyDiff();
    expect(useAppStore.getState().files[0].content).toContain('Review workflow');
    expect(useAppStore.getState().dirtyPaths).toContain('README.md');
    expect(useAppStore.getState().pendingDiff).toBeNull();
  });
});
