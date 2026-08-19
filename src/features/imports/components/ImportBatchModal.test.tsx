import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { ImportBatch } from '../../../shared/types/domain';
import { useImportStore } from '../importStore';
import { ImportBatchModal } from './ImportBatchModal';

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
      name: 'table.xlsx',
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

describe('ImportBatchModal', () => {
  beforeEach(() => {
    useImportStore.setState({
      batch,
      acceptedItemIds: ['ready', 'table'],
      loading: false,
      error: null,
    });
  });

  it('shows capability and alternatives, while confirming only readable files', async () => {
    const onConfirmed = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue({
      batch: { ...batch, status: 'confirmed', canConfirm: false },
      workspace: { id: 'workspace-1', name: '资料', available: true, kind: 'standalone' },
      documents: [
        {
          path: 'selected/ready/notes.md',
          name: 'notes.md',
          language: 'markdown',
          content: '# notes',
          contentHash: 'a'.repeat(64),
          sizeBytes: 10,
          draft: null,
          editable: true,
          extracted: false,
          sourceId: 'source-1',
        },
      ],
      sources: [],
    });
    useImportStore.setState({ confirm });
    render(
      <I18nProvider>
        <ImportBatchModal onConfirmed={onConfirmed} />
      </I18nProvider>
    );

    expect(screen.getByText('可读取和编辑')).toBeInTheDocument();
    expect(screen.getByText('基础表格数据（只读）')).toBeInTheDocument();
    expect(screen.getByText(/公式不计算/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /table.xlsx/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '确认加入资料' }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce());
  });
});
