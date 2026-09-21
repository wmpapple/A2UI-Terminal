import { afterEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/useAppStore';
import { workspaceController } from '../workspace/workspaceController';

afterEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState(useAppStore.getInitialState());
});

it('removes drafts belonging to a deleted workspace without losing another workspace draft', async () => {
  vi.spyOn(workspaceController, 'remove').mockResolvedValue({
    removed: true,
    projectFilesDeleted: false,
  });
  vi.spyOn(workspaceController, 'listRecent').mockResolvedValue([]);
  useAppStore.setState({
    runtimeMode: 'desktop',
    workspace: { id: 'a', name: 'A', kind: 'directory', available: true },
    chatDrafts: {},
  });
  useAppStore.getState().setChatDraft('a', 'session', 'removed draft');
  useAppStore.getState().setChatDraft('b', 'session', 'kept draft');
  await useAppStore.getState().removeCurrentWorkspace();
  expect(useAppStore.getState().chatDrafts).toEqual({
    [JSON.stringify(['b', 'session'])]: 'kept draft',
  });
});
