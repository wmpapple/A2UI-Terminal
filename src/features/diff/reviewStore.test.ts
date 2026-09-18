import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDiff, mockFiles } from '../../shared/mock/workspace';
import { useAppStore } from '../../stores/useAppStore';
import { reviewController } from './reviewController';

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({
    runtimeMode: 'web-mock',
    workspace: null,
    files: mockFiles,
    pendingDiff: createMockDiff(mockFiles[0]),
    patchApplying: false,
    patchError: null,
    centerView: 'diff',
  });
});

describe('saved review choices', () => {
  it('saves choices without applying or leaving review', async () => {
    const before = useAppStore.getState().files;
    await useAppStore.getState().saveReviewSelection();
    expect(useAppStore.getState().pendingDiff?.status).toBe('accepted');
    expect(useAppStore.getState().centerView).toBe('diff');
    expect(useAppStore.getState().files).toBe(before);
  });

  it('restores rejected blocks as unchecked and lets the user change them', () => {
    const proposal = createMockDiff(mockFiles[0]);
    useAppStore.setState({
      pendingDiff: {
        ...proposal,
        status: 'partially_accepted',
        blocks: [{ ...proposal.blocks[0], status: 'rejected', selected: undefined }],
      },
    });
    useAppStore.getState().togglePatchChange(proposal.blocks[0].id);
    expect(useAppStore.getState().pendingDiff?.blocks[0].selected).toBe(true);
  });

  it('persists desktop decisions without applying and retains them on apply transport failure', async () => {
    const proposal = createMockDiff(mockFiles[0]);
    const saved = {
      ...proposal,
      status: 'accepted' as const,
      blocks: proposal.blocks.map((block) => ({
        ...block,
        status: 'accepted' as const,
        selected: undefined,
      })),
    };
    useAppStore.setState({
      runtimeMode: 'desktop',
      workspace: {
        id: proposal.workspaceId,
        name: 'Test',
        kind: 'directory',
        available: true,
      },
    });
    const decide = vi.spyOn(reviewController, 'decide').mockResolvedValue(saved);
    const apply = vi
      .spyOn(reviewController, 'apply')
      .mockRejectedValue(new Error('transport unavailable'));
    await useAppStore.getState().saveReviewSelection();
    expect(decide).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    await useAppStore.getState().applyDiff();
    expect(decide).toHaveBeenCalledOnce();
    expect(useAppStore.getState().pendingDiff).toEqual(saved);
    expect(useAppStore.getState().patchError).toBeTruthy();
    expect(useAppStore.getState().patchApplying).toBe(false);
    expect(useAppStore.getState().centerView).toBe('diff');
  });
});
