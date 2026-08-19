import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSource, ImportBatch } from '../../shared/types/domain';
import { importController } from './importController';
import { useImportStore } from './importStore';

const batch: ImportBatch = {
  id: 'batch-1',
  status: 'awaiting_confirmation',
  items: [
    {
      id: 'ready',
      name: 'notes.md',
      extension: 'md',
      sizeBytes: 10,
      capability: 'editable_text',
      status: 'ready',
      readable: true,
      editable: true,
      reasonCode: null,
      reason: null,
      alternative: null,
      warnings: [],
    },
    {
      id: 'table',
      name: 'data.xlsx',
      extension: 'xlsx',
      sizeBytes: 20,
      capability: 'structured_data',
      status: 'ready',
      readable: true,
      editable: false,
      reasonCode: null,
      reason: null,
      alternative: null,
      warnings: ['公式不计算，外部链接不访问'],
    },
  ],
  totalSizeBytes: 30,
  maxFiles: 20,
  maxBatchBytes: 100 * 1024 * 1024,
  canConfirm: true,
  failureCode: null,
  failureReason: null,
};

const source = (id: string, name: string): DocumentSource => ({
  id,
  workspaceId: 'workspace-1',
  name,
  extension: 'csv',
  kind: 'table',
  capability: 'structured_data',
  mimeType: 'text/csv',
  sizeBytes: 20,
  contentHash: id.padEnd(64, '0').slice(0, 64),
  editable: false,
  warnings: [],
  table: {
    sheetNames: ['CSV'],
    rowCount: 2,
    columnCount: 2,
    cellCount: 4,
    formulaCellCount: 0,
    formulaInjectionRiskCellCount: 0,
    limits: {
      maxSheets: 32,
      maxRowsPerSheet: 10_000,
      maxColumnsPerSheet: 256,
      maxCellsTotal: 100_000,
      maxCellChars: 32_768,
    },
  },
  image: null,
});

describe('importStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useImportStore.setState({
      batch: null,
      acceptedItemIds: [],
      loading: false,
      error: null,
      sources: [],
      sourceContent: null,
      sourceLoading: false,
      revokingSourceId: null,
    });
  });

  it('selects text and structured sources that are currently readable', async () => {
    vi.spyOn(importController, 'select').mockResolvedValue(structuredClone(batch));
    await useImportStore.getState().select('workspace-1');
    expect(useImportStore.getState().acceptedItemIds).toEqual(['ready', 'table']);
    expect(useImportStore.getState().batch?.items[1].capability).toBe('structured_data');
  });

  it('cancels through the backend so no authorization is left pending', async () => {
    const cancel = vi.spyOn(importController, 'cancel').mockResolvedValue({
      batch: { ...batch, status: 'cancelled', canConfirm: false },
      workspace: null,
      documents: [],
      sources: [],
    });
    useImportStore.setState({ batch, acceptedItemIds: ['ready'] });
    await useImportStore.getState().cancel();
    expect(cancel).toHaveBeenCalledWith('batch-1');
    expect(useImportStore.getState().batch).toBeNull();
  });

  it('accepts only the sanitized native-drop outcome and still requires confirmation', () => {
    useImportStore.getState().receiveDrop({
      targetId: 'drop-target',
      batch: structuredClone(batch),
      errorCode: null,
      errorMessage: null,
    });

    expect(useImportStore.getState().batch?.id).toBe('batch-1');
    expect(useImportStore.getState().acceptedItemIds).toEqual(['ready', 'table']);
  });

  it('surfaces a sanitized native-drop failure without creating a batch', () => {
    useImportStore.getState().receiveDrop({
      targetId: 'drop-target',
      batch: null,
      errorCode: 'INVALID_INPUT',
      errorMessage: '没有可检查的本地文件',
    });

    expect(useImportStore.getState().batch).toBeNull();
    expect(useImportStore.getState().error).toBe('没有可检查的本地文件');
  });

  it('reloads the complete workspace source list after a later batch is confirmed', async () => {
    const earlier = source('earlier', 'first.csv');
    const later = source('later', 'second.csv');
    vi.spyOn(importController, 'confirm').mockResolvedValue({
      batch: { ...batch, status: 'confirmed', canConfirm: false },
      workspace: { id: 'workspace-1', name: '资料', available: true, kind: 'standalone' },
      documents: [],
      sources: [later],
    });
    vi.spyOn(importController, 'listSources').mockResolvedValue([earlier, later]);
    useImportStore.setState({ batch, acceptedItemIds: ['ready'], sources: [earlier] });

    const confirmation = await useImportStore.getState().confirm();

    expect(confirmation?.sources).toEqual([later]);
    expect(useImportStore.getState().sources.map((item) => item.name)).toEqual([
      'first.csv',
      'second.csv',
    ]);
    expect(importController.listSources).toHaveBeenCalledWith('workspace-1');
  });

  it('keeps the merged sources when the post-confirm refresh fails', async () => {
    const earlier = source('earlier', 'first.csv');
    const later = source('later', 'second.csv');
    vi.spyOn(importController, 'confirm').mockResolvedValue({
      batch: { ...batch, status: 'confirmed', canConfirm: false },
      workspace: { id: 'workspace-1', name: '资料', available: true, kind: 'standalone' },
      documents: [],
      sources: [later],
    });
    vi.spyOn(importController, 'listSources').mockRejectedValue(new Error('刷新暂时不可用'));
    useImportStore.setState({ batch, acceptedItemIds: ['ready'], sources: [earlier] });

    await expect(useImportStore.getState().confirm()).resolves.not.toBeNull();
    expect(useImportStore.getState().sources.map((item) => item.name)).toEqual([
      'first.csv',
      'second.csv',
    ]);
    expect(useImportStore.getState().error).toContain('资料已加入');
  });

  it('revokes one source, closes its preview, and reloads the remaining workspace sources', async () => {
    const removed = source('removed', 'remove.csv');
    const retained = source('retained', 'keep.csv');
    vi.spyOn(importController, 'revokeSource').mockResolvedValue({
      revoked: true,
      originalFileDeleted: false,
    });
    vi.spyOn(importController, 'listSources').mockResolvedValue([retained]);
    useImportStore.setState({
      sources: [removed, retained],
      sourceContent: {
        source: removed,
        textContent: null,
        tableContent: { sheets: [], limits: removed.table!.limits },
        imageDataUrl: null,
        visualModelAvailable: false,
        notice: '本地预览',
      },
    });

    await expect(useImportStore.getState().revokeSource('workspace-1', 'removed')).resolves.toBe(
      true
    );

    expect(importController.revokeSource).toHaveBeenCalledWith('workspace-1', 'removed');
    expect(useImportStore.getState().sources).toEqual([retained]);
    expect(useImportStore.getState().sourceContent).toBeNull();
    expect(useImportStore.getState().revokingSourceId).toBeNull();
  });

  it('keeps the locally revoked source removed when the post-revoke refresh fails', async () => {
    const removed = source('removed', 'remove.csv');
    const retained = source('retained', 'keep.csv');
    vi.spyOn(importController, 'revokeSource').mockResolvedValue({
      revoked: true,
      originalFileDeleted: false,
    });
    vi.spyOn(importController, 'listSources').mockRejectedValue(new Error('刷新暂时不可用'));
    useImportStore.setState({ sources: [removed, retained] });

    await expect(useImportStore.getState().revokeSource('workspace-1', 'removed')).resolves.toBe(
      true
    );

    expect(useImportStore.getState().sources).toEqual([retained]);
    expect(useImportStore.getState().error).toContain('授权已取消');
  });

  it('leaves the source visible when revocation is rejected', async () => {
    const retained = source('retained', 'keep.csv');
    vi.spyOn(importController, 'revokeSource').mockRejectedValue(
      new Error('资料来源不存在或未获当前工作区授权')
    );
    useImportStore.setState({ sources: [retained] });

    await expect(
      useImportStore.getState().revokeSource('other-workspace', 'retained')
    ).resolves.toBe(false);

    expect(useImportStore.getState().sources).toEqual([retained]);
    expect(useImportStore.getState().error).toContain('未获当前工作区授权');
  });

  it('does not restore a stale preview after its source authorization is removed', async () => {
    const removed = source('removed', 'remove.csv');
    let resolveRead!: (content: Awaited<ReturnType<typeof importController.readSource>>) => void;
    vi.spyOn(importController, 'readSource').mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      })
    );
    useImportStore.setState({ sources: [removed] });

    const preview = useImportStore.getState().previewSource('removed');
    useImportStore.setState({ sources: [] });
    resolveRead({
      source: removed,
      textContent: null,
      tableContent: { sheets: [], limits: removed.table!.limits },
      imageDataUrl: null,
      visualModelAvailable: false,
      notice: '旧预览',
    });
    await preview;

    expect(useImportStore.getState().sourceContent).toBeNull();
  });
});
