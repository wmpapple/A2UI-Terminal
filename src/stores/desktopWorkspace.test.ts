import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopApi } from '../shared/platform/desktop';
import { useAppStore } from './useAppStore';

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
});

describe('desktop workspace state', () => {
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
