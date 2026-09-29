import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writingProjectController } from './writingProjectController';
const gateway = vi.hoisted(() => ({ saveWritingDraft: vi.fn() }));
vi.mock('../../shared/platform/gateway', () => ({ desktopGateway: gateway }));
vi.mock('../../shared/platform/runtime', () => ({ isWebMock: () => false }));
vi.mock('./writingProjectMock', () => ({ writingProjectMock: {} }));
beforeEach(() => vi.resetAllMocks());
describe('durable section drafts', () => {
  it('serializes edits so a slow earlier save cannot overwrite the newest text', async () => {
    let release!: () => void;
    gateway.saveWritingDraft
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined);
    const first = writingProjectController.saveDraft('run', 'first', 'fact');
    const second = writingProjectController.saveDraft('run', 'second', 'fact');
    await vi.waitFor(() => expect(gateway.saveWritingDraft).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(gateway.saveWritingDraft.mock.calls.map((c) => c[1])).toEqual(['first', 'second']);
  });
  it('allows the next save after an earlier disk failure and reports that failure', async () => {
    gateway.saveWritingDraft
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined);
    await expect(writingProjectController.saveDraft('retry', 'first', 'fact')).rejects.toThrow(
      'disk full'
    );
    await expect(
      writingProjectController.saveDraft('retry', 'corrected', 'fact')
    ).resolves.toBeUndefined();
  });
});
