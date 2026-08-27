import { beforeEach, describe, expect, it } from 'vitest';
import { mockFiles, mockSessions } from '../shared/mock/workspace';
import { useAppStore } from './useAppStore';

beforeEach(() => {
  useAppStore.setState({
    runtimeMode: 'web-mock',
    workspace: null,
    workspaceEntries: mockFiles.map((file) => ({
      path: file.path,
      name: file.name,
      language: file.language,
      sizeBytes: file.content.length,
      readable: true,
      editable: true,
      extracted: false,
    })),
    files: mockFiles,
    openPaths: ['README.md'],
    activePath: 'README.md',
    dirtyPaths: [],
    centerView: 'editor',
    sessions: mockSessions,
    activeSessionId: 'welcome',
    pendingDiff: null,
    chatRequestId: null,
    a2uiSurfaces: [],
    a2uiInspections: [],
    activeSurfaceId: '',
    activeInspectionId: '',
    a2uiNotice: null,
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

  it('does not mutate a file when every patch block is rejected', async () => {
    const before = useAppStore.getState().files[0].content;
    useAppStore.getState().createProposal();
    const changeId = useAppStore.getState().pendingDiff?.blocks[0].id;
    if (!changeId) throw new Error('mock patch missing');
    useAppStore.getState().togglePatchChange(changeId);
    await useAppStore.getState().applyDiff();
    expect(useAppStore.getState().files[0].content).toBe(before);
    expect(useAppStore.getState().pendingDiff).not.toBeNull();
  });

  it('undoes an applied mock patch without discarding the history marker early', async () => {
    const before = useAppStore.getState().files[0].content;
    useAppStore.getState().createProposal();
    await useAppStore.getState().applyDiff();
    expect(useAppStore.getState().lastPatchApplication).not.toBeNull();
    const undone = await useAppStore.getState().undoLastPatch();
    expect(undone).toBe(true);
    expect(useAppStore.getState().files[0].content).toBe(before);
    expect(useAppStore.getState().lastPatchApplication).toBeNull();
  });

  it('routes an A2UI request to the trusted Web Mock runtime and records actions', async () => {
    await useAppStore.getState().sendChat('Create an A2UI form', 'web-manifest');
    expect(useAppStore.getState().centerView).toBe('surface');
    expect(useAppStore.getState().a2uiSurfaces[0]?.surfaceId).toBe('web-mock-form');
    await useAppStore.getState().executeA2uiAction('name', 'change', 'Grace');
    expect(useAppStore.getState().a2uiSurfaces[0]?.data.name).toBe('Grace');
    expect(useAppStore.getState().a2uiSurfaces[0]?.events).toHaveLength(1);
    await useAppStore.getState().executeA2uiAction('role', 'change', 'designer');
    expect(useAppStore.getState().a2uiSurfaces[0]?.events[0]?.componentId).toBe('role');
    expect(useAppStore.getState().a2uiSurfaces[0]?.events[1]?.componentId).toBe('name');
  });

  it('creates selection-sourced review proposals without writing before acceptance', async () => {
    const before = useAppStore.getState().files[0].content;
    await useAppStore
      .getState()
      .sendChat('润色当前选区并返回 document_patch JSON', 'web-manifest', 'selection', false);
    expect(useAppStore.getState().pendingDiff?.source).toBe('selection');
    expect(useAppStore.getState().files[0].content).toBe(before);
  });

  it('keeps selection explanations read-only', async () => {
    const before = useAppStore.getState().files[0].content;
    await useAppStore
      .getState()
      .sendChat('解释当前选区，不要修改文件', 'web-manifest', 'selection', true);
    expect(useAppStore.getState().pendingDiff).toBeNull();
    expect(useAppStore.getState().files[0].content).toBe(before);
    expect(useAppStore.getState().sessions[0].messages.at(-1)?.content).toContain('只读解释');
  });
});
