import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopApi } from '../shared/platform/desktop';
import { createMockCreateFileReview } from '../shared/mock/workspace';
import { useAppStore } from './useAppStore';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({
    runtimeMode: 'desktop',
    workspace: null,
    recentWorkspaces: [],
    workspaceEntries: [],
    workspaceLoading: false,
    workspaceError: null,
    files: [],
    openPaths: [],
    activePath: '',
    dirtyPaths: [],
    saveStatusByPath: {},
    recoveryDrafts: {},
    recoveryDraftSummaries: [],
    documentVersions: [],
    versionPreview: null,
    versionHistoryPath: '',
    versionHistoryLoading: false,
    versionHistoryError: null,
  });
  vi.spyOn(desktopApi, 'listRecoveryDrafts').mockResolvedValue([]);
  vi.spyOn(desktopApi, 'listActiveReviews').mockResolvedValue([]);
});

describe('desktop workspace state', () => {
  it('does not let a stale editor callback modify a same-path file in another workspace', () => {
    useAppStore.setState({
      workspace: {
        id: 'workspace-b',
        name: 'Workspace B',
        available: true,
        kind: 'directory',
      },
      files: [
        {
          path: 'notes.md',
          name: 'notes.md',
          language: 'markdown',
          content: 'Workspace B content',
          contentHash: 'hash-b',
          editable: true,
        },
      ],
      dirtyPaths: [],
    });

    useAppStore.getState().updateFile('notes.md', 'Workspace A content', 'workspace-a');

    expect(useAppStore.getState().files[0].content).toBe('Workspace B content');
    expect(useAppStore.getState().dirtyPaths).toEqual([]);
  });

  it('does not apply an old save response to a same-path file in another workspace', async () => {
    const saveResponse = deferred<{ path: string; contentHash: string; sizeBytes: number }>();
    vi.spyOn(desktopApi, 'saveWorkspaceDraft').mockResolvedValue();
    const save = vi.spyOn(desktopApi, 'saveWorkspaceFile').mockReturnValue(saveResponse.promise);
    useAppStore.setState({
      workspace: {
        id: 'workspace-a',
        name: 'Workspace A',
        available: true,
        kind: 'directory',
      },
      files: [
        {
          path: 'notes.md',
          name: 'notes.md',
          language: 'markdown',
          content: 'Workspace A changed',
          contentHash: 'hash-a',
          editable: true,
        },
      ],
      dirtyPaths: ['notes.md'],
      saveStatusByPath: { 'notes.md': 'dirty' },
    });

    const pendingSave = useAppStore.getState().saveFileToDisk('notes.md', 'workspace-a');
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    useAppStore.setState({
      workspace: {
        id: 'workspace-b',
        name: 'Workspace B',
        available: true,
        kind: 'directory',
      },
      files: [
        {
          path: 'notes.md',
          name: 'notes.md',
          language: 'markdown',
          content: 'Workspace B content',
          contentHash: 'hash-b',
          editable: true,
        },
      ],
      dirtyPaths: [],
      saveStatusByPath: { 'notes.md': 'saved' },
    });
    saveResponse.resolve({ path: 'notes.md', contentHash: 'saved-hash-a', sizeBytes: 19 });
    await pendingSave;

    expect(useAppStore.getState().files[0]).toMatchObject({
      content: 'Workspace B content',
      contentHash: 'hash-b',
    });
    expect(useAppStore.getState().saveStatusByPath['notes.md']).toBe('saved');
  });

  it('restores the newest persistent review after reopening a workspace', async () => {
    const review = { ...createMockCreateFileReview(), workspaceId: 'workspace-1' };
    vi.mocked(desktopApi.listActiveReviews).mockResolvedValue([review]);
    vi.spyOn(desktopApi, 'restoreWorkspace').mockResolvedValue({
      id: 'workspace-1',
      name: 'Project',
      available: true,
      kind: 'directory',
    });
    vi.spyOn(desktopApi, 'listWorkspaceFiles').mockResolvedValue([]);
    vi.spyOn(desktopApi, 'listChatSessions').mockResolvedValue([
      { id: 'session-1', title: 'New chat', messages: [] },
    ]);

    await useAppStore.getState().restoreWorkspace('workspace-1');

    expect(useAppStore.getState().pendingDiff?.id).toBe(review.id);
    expect(useAppStore.getState().centerView).toBe('diff');
  });

  it('keeps the review undo marker and exposes the backend error when undo fails', async () => {
    vi.spyOn(desktopApi, 'undoReview').mockRejectedValue({
      code: 'FILE_CONFLICT',
      message: '成果已被修改，不能直接撤销',
    });
    useAppStore.setState({
      workspace: {
        id: 'workspace-1',
        name: 'Project',
        available: true,
        kind: 'directory',
      },
      lastReviewApplication: {
        reviewId: 'review-1',
        status: 'applied',
        operationId: null,
        files: [],
        result: null,
      },
      lastPatchApplication: null,
      patchError: null,
    });

    const undone = await useAppStore.getState().undoLastPatch();

    expect(undone).toBe(false);
    expect(useAppStore.getState().lastReviewApplication?.reviewId).toBe('review-1');
    expect(useAppStore.getState().patchError).toBe('成果已被修改，不能直接撤销');
  });

  it('undoes a reopened AI result from its persisted review origin without transient state', async () => {
    const undo = vi.spyOn(desktopApi, 'undoReview').mockResolvedValue({
      reviewId: 'review-persisted',
      status: 'undone',
      operationId: null,
      files: [],
      result: null,
    });
    useAppStore.setState({
      workspace: null,
      lastReviewApplication: null,
      lastPatchApplication: null,
      patchError: null,
    });

    const undone = await useAppStore.getState().undoLastPatch({
      reviewId: 'review-persisted',
      workspaceId: 'workspace-source',
    });

    expect(undone).toBe(true);
    expect(undo).toHaveBeenCalledWith({
      reviewId: 'review-persisted',
      workspaceId: 'workspace-source',
    });
    expect(useAppStore.getState().patchError).toBeNull();
  });

  it('keeps the latest workspace selection when restore requests finish out of order', async () => {
    const restoreA = deferred<{
      id: string;
      name: string;
      available: boolean;
      kind: 'directory';
    }>();
    const restoreB = deferred<{
      id: string;
      name: string;
      available: boolean;
      kind: 'directory';
    }>();
    const restore = vi
      .spyOn(desktopApi, 'restoreWorkspace')
      .mockImplementation((workspaceId) =>
        workspaceId === 'workspace-a' ? restoreA.promise : restoreB.promise
      );
    vi.spyOn(desktopApi, 'listWorkspaceFiles').mockResolvedValue([]);
    vi.spyOn(desktopApi, 'listChatSessions').mockImplementation(async (workspaceId) => [
      { id: `session-${workspaceId}`, title: 'New chat', messages: [] },
    ]);

    const pendingA = useAppStore.getState().restoreWorkspace('workspace-a');
    await vi.waitFor(() => expect(restore).toHaveBeenCalledWith('workspace-a'));
    const pendingB = useAppStore.getState().restoreWorkspace('workspace-b');
    restoreB.resolve({
      id: 'workspace-b',
      name: 'Workspace B',
      available: true,
      kind: 'directory',
    });
    await pendingB;
    restoreA.resolve({
      id: 'workspace-a',
      name: 'Workspace A',
      available: true,
      kind: 'directory',
    });
    await pendingA;

    expect(useAppStore.getState().workspace?.id).toBe('workspace-b');
    expect(useAppStore.getState().activeSessionId).toBe('session-workspace-b');
  });

  it('creates a standalone workspace for directly selected files', async () => {
    useAppStore.setState({ centerView: 'surface' });
    const workspace = {
      id: 'standalone-1',
      name: '独立文件',
      available: true,
      kind: 'standalone' as const,
    };
    vi.spyOn(desktopApi, 'selectContextFiles').mockResolvedValue({
      workspace,
      documents: [
        {
          path: 'selected/file-1/notes.md',
          name: 'notes.md',
          language: 'markdown',
          content: '# Notes',
          contentHash: 'notes-hash',
          sizeBytes: 7,
          draft: null,
          editable: true,
          extracted: false,
          sourceId: 'file-1',
        },
      ],
    });
    vi.spyOn(desktopApi, 'listRecentWorkspaces').mockResolvedValue([workspace]);
    vi.spyOn(desktopApi, 'listChatSessions').mockResolvedValue([
      { id: 'session-1', title: 'New chat', messages: [] },
    ]);

    await useAppStore.getState().selectContextFiles();

    expect(useAppStore.getState().workspace).toEqual(workspace);
    expect(useAppStore.getState().activeSessionId).toBe('session-1');
    expect(useAppStore.getState().activePath).toBe('selected/file-1/notes.md');
    expect(useAppStore.getState().files[0].sourceId).toBe('file-1');
    expect(useAppStore.getState().workspaceEntries[0].name).toBe('notes.md');
    expect(useAppStore.getState().centerView).toBe('editor');
  });

  it('replaces workspace-scoped editor state when selected files belong to another workspace', async () => {
    const workspaceB = {
      id: 'standalone-b',
      name: 'Standalone B',
      available: true,
      kind: 'standalone' as const,
    };
    useAppStore.setState({
      workspace: {
        id: 'workspace-a',
        name: 'Workspace A',
        available: true,
        kind: 'directory',
      },
      files: [
        {
          path: 'notes.md',
          name: 'notes.md',
          language: 'markdown',
          content: 'Workspace A content',
          contentHash: 'hash-a',
        },
      ],
      workspaceEntries: [
        {
          path: 'notes.md',
          name: 'notes.md',
          language: 'markdown',
          sizeBytes: 19,
          readable: true,
          editable: true,
          extracted: false,
        },
      ],
      openPaths: ['notes.md'],
      activePath: 'notes.md',
      contextBySession: {
        'session-a': {
          selection: false,
          currentFile: true,
          recentMessages: false,
          recentMessageCount: 0,
          projectFiles: ['notes.md'],
          documentSourceIds: [],
        },
      },
      selectedText: 'Workspace A selection',
    });
    vi.spyOn(desktopApi, 'selectContextFiles').mockResolvedValue({
      workspace: workspaceB,
      documents: [
        {
          path: 'selected/file-b/report.md',
          name: 'report.md',
          language: 'markdown',
          content: 'Workspace B content',
          contentHash: 'hash-b',
          sizeBytes: 19,
          draft: null,
          editable: true,
          extracted: false,
          sourceId: 'file-b',
        },
      ],
    });
    vi.spyOn(desktopApi, 'listRecentWorkspaces').mockResolvedValue([workspaceB]);
    vi.spyOn(desktopApi, 'listChatSessions').mockResolvedValue([
      { id: 'session-b', title: 'Workspace B chat', messages: [] },
    ]);

    await useAppStore.getState().selectContextFiles();

    expect(useAppStore.getState()).toMatchObject({
      workspace: workspaceB,
      openPaths: ['selected/file-b/report.md'],
      activePath: 'selected/file-b/report.md',
      dirtyPaths: [],
      selectedText: '',
      contextBySession: {},
    });
    expect(useAppStore.getState().files).toHaveLength(1);
    expect(useAppStore.getState().files[0]).toMatchObject({
      path: 'selected/file-b/report.md',
      content: 'Workspace B content',
    });
    expect(useAppStore.getState().workspaceEntries).toHaveLength(1);
  });

  it('holds a crash draft for confirmation without auto-saving it', async () => {
    useAppStore.setState({ centerView: 'surface' });
    vi.mocked(desktopApi.listRecoveryDrafts).mockResolvedValue([
      {
        relativePath: 'src/main.ts',
        baseHash: 'disk-hash',
        updatedAt: '2026-08-06 08:00:00',
        currentHash: 'disk-hash',
        conflict: false,
        available: true,
      },
    ]);
    vi.spyOn(desktopApi, 'restoreWorkspace').mockResolvedValue({
      id: 'workspace-1',
      name: 'Project',
      available: true,
      kind: 'directory',
    });
    vi.spyOn(desktopApi, 'listWorkspaceFiles').mockResolvedValue([
      {
        path: 'src/main.ts',
        name: 'main.ts',
        language: 'typescript',
        sizeBytes: 18,
        readable: true,
        editable: true,
        extracted: false,
      },
    ]);
    vi.spyOn(desktopApi, 'listChatSessions').mockResolvedValue([
      { id: 'session-1', title: 'New chat', messages: [] },
    ]);
    vi.spyOn(desktopApi, 'readWorkspaceFile').mockResolvedValue({
      path: 'src/main.ts',
      name: 'main.ts',
      language: 'typescript',
      content: 'export const a = 1;',
      contentHash: 'disk-hash',
      sizeBytes: 18,
      editable: true,
      extracted: false,
      draft: {
        content: 'export const a = 2;',
        baseHash: 'disk-hash',
        updatedAt: '2026-08-06 08:00:00',
      },
    });

    await useAppStore.getState().restoreWorkspace('workspace-1');
    expect(useAppStore.getState().recoveryDraftSummaries).toHaveLength(1);
    expect(useAppStore.getState().centerView).toBe('editor');
    await useAppStore.getState().openFile('src/main.ts');

    expect(useAppStore.getState().files[0]).toMatchObject({
      content: 'export const a = 1;',
      contentHash: 'disk-hash',
    });
    expect(useAppStore.getState().dirtyPaths).not.toContain('src/main.ts');
    expect(useAppStore.getState().saveStatusByPath['src/main.ts']).toBe('draft');
    expect(useAppStore.getState().recoveryDrafts['src/main.ts']?.content).toBe(
      'export const a = 2;'
    );

    useAppStore.getState().restoreRecoveryDraft('src/main.ts');
    expect(useAppStore.getState().files[0].content).toBe('export const a = 2;');
    expect(useAppStore.getState().dirtyPaths).toContain('src/main.ts');
    expect(useAppStore.getState().recoveryDrafts['src/main.ts']).toBeUndefined();
  });

  it('keeps dirty content when the backend reports an external change', async () => {
    vi.spyOn(desktopApi, 'saveWorkspaceDraft').mockResolvedValue();
    vi.spyOn(desktopApi, 'saveWorkspaceFile').mockRejectedValue({
      code: 'FILE_CONFLICT',
      message: 'file changed outside A2UI Terminal',
    });
    useAppStore.setState({
      workspace: { id: 'workspace-1', name: 'Project', available: true, kind: 'directory' },
      files: [
        {
          path: 'config.json',
          name: 'config.json',
          language: 'json',
          content: '{"local":true}',
          contentHash: 'old-hash',
        },
      ],
      openPaths: ['config.json'],
      activePath: 'config.json',
      dirtyPaths: ['config.json'],
    });

    await useAppStore.getState().saveFileToDisk('config.json');

    expect(useAppStore.getState().dirtyPaths).toContain('config.json');
    expect(useAppStore.getState().saveStatusByPath['config.json']).toBe('conflict');
    expect(useAppStore.getState().files[0].content).toBe('{"local":true}');
  });

  it('does not edit or dirty an extracted document', () => {
    useAppStore.setState({
      files: [
        {
          path: 'requirements.docx',
          name: 'requirements.docx',
          language: 'word',
          content: 'Extracted body',
          contentHash: 'document-hash',
          editable: false,
          extracted: true,
        },
      ],
      dirtyPaths: [],
    });

    useAppStore.getState().updateFile('requirements.docx', 'changed');

    expect(useAppStore.getState().files[0].content).toBe('Extracted body');
    expect(useAppStore.getState().dirtyPaths).toEqual([]);
  });

  it('saves a directly selected text file through its authorization id', async () => {
    const saveDraft = vi.spyOn(desktopApi, 'saveWorkspaceDraft').mockResolvedValue();
    const save = vi.spyOn(desktopApi, 'saveContextFile').mockResolvedValue({
      path: 'notes.md',
      contentHash: 'new-hash',
      sizeBytes: 9,
    });
    useAppStore.setState({
      workspace: {
        id: 'standalone-1',
        name: '独立文件',
        available: true,
        kind: 'standalone',
      },
      files: [
        {
          path: 'selected/file-1/notes.md',
          name: 'notes.md',
          language: 'markdown',
          content: '# Changed',
          contentHash: 'old-hash',
          editable: true,
          sourceId: 'file-1',
        },
      ],
      dirtyPaths: ['selected/file-1/notes.md'],
    });

    await useAppStore.getState().saveFileToDisk('selected/file-1/notes.md');

    expect(saveDraft).toHaveBeenCalledWith(
      'standalone-1',
      'selected/file-1/notes.md',
      '# Changed',
      'old-hash'
    );
    expect(save).toHaveBeenCalledWith('file-1', '# Changed', 'old-hash');
    expect(useAppStore.getState().dirtyPaths).toEqual([]);
    expect(useAppStore.getState().saveStatusByPath['selected/file-1/notes.md']).toBe('saved');
  });

  it('forgets revoked source content from open files and saved context selections', () => {
    const path = 'selected/file-1/notes.md';
    useAppStore.setState({
      files: [
        {
          path,
          name: 'notes.md',
          language: 'markdown',
          content: '# Local copy',
          contentHash: 'hash',
          sourceId: 'file-1',
        },
      ],
      workspaceEntries: [
        {
          path,
          name: 'notes.md',
          language: 'markdown',
          sizeBytes: 12,
          readable: true,
          editable: true,
          extracted: false,
          sourceId: 'file-1',
        },
      ],
      openPaths: [path],
      activePath: path,
      dirtyPaths: [path],
      selectedText: 'Local copy',
      saveStatusByPath: { [path]: 'dirty' },
      contextBySession: {
        'session-1': {
          selection: false,
          currentFile: false,
          recentMessages: false,
          recentMessageCount: 0,
          projectFiles: [path, 'retained.md'],
          documentSourceIds: ['file-1', 'retained-source'],
        },
      },
      versionHistoryPath: path,
      documentVersions: [
        {
          id: 'version-1',
          relativePath: path,
          contentHash: 'hash',
          source: 'initial',
          summary: null,
          versionKind: 'snapshot',
          createdAt: '2026-08-19',
          isCurrent: true,
        },
      ],
    });

    useAppStore.getState().forgetAuthorizedSource('file-1');

    expect(useAppStore.getState()).toMatchObject({
      files: [],
      workspaceEntries: [],
      openPaths: [],
      activePath: '',
      dirtyPaths: [],
      selectedText: '',
      documentVersions: [],
      versionHistoryPath: '',
    });
    expect(useAppStore.getState().contextBySession['session-1'].projectFiles).toEqual([
      'retained.md',
    ]);
    expect(useAppStore.getState().contextBySession['session-1'].documentSourceIds).toEqual([
      'retained-source',
    ]);
  });

  it('loads persistent history and restores a selected version with the current hash', async () => {
    const version = {
      id: 'version-1',
      relativePath: 'notes.md',
      contentHash: 'old-hash',
      source: 'initial' as const,
      summary: 'Initial version',
      versionKind: 'snapshot' as const,
      createdAt: '2026-08-11 10:00:00',
      isCurrent: false,
    };
    vi.spyOn(desktopApi, 'listDocumentVersions').mockResolvedValue([version]);
    vi.spyOn(desktopApi, 'readDocumentVersion').mockResolvedValue({
      ...version,
      content: '# Old\n',
    });
    const restore = vi.spyOn(desktopApi, 'restoreDocumentVersion').mockResolvedValue({
      path: 'notes.md',
      contentHash: 'old-hash',
      sizeBytes: 6,
    });
    useAppStore.setState({
      workspace: { id: 'workspace-1', name: 'Project', available: true, kind: 'directory' },
      files: [
        {
          path: 'notes.md',
          name: 'notes.md',
          language: 'markdown',
          content: '# Current\n',
          contentHash: 'current-hash',
          editable: true,
        },
      ],
      openPaths: ['notes.md'],
      activePath: 'notes.md',
      dirtyPaths: [],
    });

    await useAppStore.getState().loadDocumentVersions('notes.md');
    await useAppStore.getState().previewDocumentVersion('notes.md', 'version-1');
    expect(useAppStore.getState().versionPreview?.content).toBe('# Old\n');

    await useAppStore.getState().restoreDocumentVersion('notes.md', 'version-1');

    expect(restore).toHaveBeenCalledWith('workspace-1', 'notes.md', 'version-1', 'current-hash');
    expect(useAppStore.getState().files[0]).toMatchObject({
      content: '# Old\n',
      contentHash: 'old-hash',
    });
    expect(useAppStore.getState().versionPreview).toBeNull();
  });
});
