import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextPack } from '../../shared/types/domain';
import { contextPackController } from './contextPackController';
import { useContextPackStore } from './contextPackStore';

const pack = (id = 'pack-1'): ContextPack => ({
  id,
  workspaceId: 'workspace-1',
  name: 'Research pack',
  items: [
    { sourceId: 'source-1', label: 'notes.md' },
    { sourceId: 'source-2', label: 'data.csv' },
  ],
  createdAt: '2026-09-10 11:00:00',
  updatedAt: '2026-09-10 11:00:00',
});

describe('contextPackStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useContextPackStore.setState({ packs: [], loading: false, error: null });
  });

  it('loads and creates workspace-scoped reference packs', async () => {
    vi.spyOn(contextPackController, 'list').mockResolvedValue([pack()]);
    await useContextPackStore.getState().load('workspace-1');
    expect(contextPackController.list).toHaveBeenCalledWith('workspace-1');
    expect(useContextPackStore.getState().packs).toEqual([pack()]);

    const created = pack('pack-2');
    vi.spyOn(contextPackController, 'create').mockResolvedValue(created);
    await expect(
      useContextPackStore
        .getState()
        .createPack('workspace-1', 'Research pack', ['source-1', 'source-2'])
    ).resolves.toBe(true);
    expect(contextPackController.create).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      name: 'Research pack',
      sourceIds: ['source-1', 'source-2'],
    });
    expect(useContextPackStore.getState().packs[0]).toEqual(created);
  });

  it('deletes only the pack and leaves source ownership to the import store', async () => {
    vi.spyOn(contextPackController, 'delete').mockResolvedValue({
      deleted: true,
      originalFilesDeleted: false,
    });
    useContextPackStore.setState({ packs: [pack()] });

    await expect(useContextPackStore.getState().deletePack('workspace-1', 'pack-1')).resolves.toBe(
      true
    );

    expect(contextPackController.delete).toHaveBeenCalledWith('workspace-1', 'pack-1');
    expect(useContextPackStore.getState().packs).toEqual([]);
  });

  it('removes a revoked source from every pack and drops packs that become empty', () => {
    useContextPackStore.setState({
      packs: [
        pack(),
        {
          ...pack('pack-only'),
          items: [{ sourceId: 'source-1', label: 'notes.md' }],
        },
      ],
    });

    useContextPackStore.getState().forgetSource('workspace-1', 'source-1');

    expect(useContextPackStore.getState().packs).toEqual([
      expect.objectContaining({
        id: 'pack-1',
        items: [{ sourceId: 'source-2', label: 'data.csv' }],
      }),
    ]);
  });
});
