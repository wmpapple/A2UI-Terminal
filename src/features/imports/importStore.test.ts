import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportBatch } from '../../shared/types/domain';
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
      id: 'planned',
      name: 'data.xlsx',
      extension: 'xlsx',
      sizeBytes: 20,
      capability: 'planned_structured_data',
      status: 'planned',
      readable: false,
      editable: false,
      reasonCode: 'ADAPTER_NOT_READY',
      reason: '下一阶段开放',
      alternative: '导出 CSV',
      warnings: [],
    },
  ],
  totalSizeBytes: 30,
  maxFiles: 20,
  maxBatchBytes: 100 * 1024 * 1024,
  canConfirm: true,
  failureCode: null,
  failureReason: null,
};

describe('importStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useImportStore.setState({ batch: null, acceptedItemIds: [], loading: false, error: null });
  });

  it('selects only currently readable items by default', async () => {
    vi.spyOn(importController, 'select').mockResolvedValue(structuredClone(batch));
    await useImportStore.getState().select('workspace-1');
    expect(useImportStore.getState().acceptedItemIds).toEqual(['ready']);
    expect(useImportStore.getState().batch?.items[1].reasonCode).toBe('ADAPTER_NOT_READY');
  });

  it('cancels through the backend so no authorization is left pending', async () => {
    const cancel = vi.spyOn(importController, 'cancel').mockResolvedValue({
      batch: { ...batch, status: 'cancelled', canConfirm: false },
      workspace: null,
      documents: [],
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
    expect(useImportStore.getState().acceptedItemIds).toEqual(['ready']);
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
});
