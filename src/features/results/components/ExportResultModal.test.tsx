import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../../contracts/v2/result.json';
import { isResultDocument } from '../../../shared/contracts/guards';
import type { ExportResultOutput } from '../../../shared/types/domain';
import { resultController } from '../resultController';
import { resultInitialState, useResultStore } from '../resultStore';
import { ExportResultModal } from './ExportResultModal';

vi.mock('../../../app/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

if (!isResultDocument(fixture.document)) throw new Error('Invalid Result fixture');
const document = fixture.document;

describe('ExportResultModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useResultStore.setState({
      ...resultInitialState,
      activeDocument: document,
      draftContent: document.content,
    });
  });

  it('awaits saving and exports only the resulting revision without the draft body', async () => {
    const saved = {
      ...document,
      content: 'saved draft',
      result: { ...document.result, currentRevisionId: 'new-revision' },
    };
    useResultStore.setState({
      draftContent: saved.content,
      save: vi.fn(async () => {
        useResultStore.setState({ activeDocument: saved, draftContent: saved.content });
      }),
    });
    const send = vi.spyOn(resultController, 'export').mockImplementation(async (input) => ({
      ...input,
      status: 'completed',
      fileName: 'result.pdf',
    }));
    render(<ExportResultModal document={document} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'startExport' }));
    await screen.findByText('exportMockCompleted');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({
      exportId: expect.any(String),
      resultId: document.result.id,
      revisionId: 'new-revision',
      format: 'pdf',
    });
    expect(useResultStore.getState().draftContent).toBe('saved draft');
  });

  it('does not export an unsaved draft when saving fails', async () => {
    useResultStore.setState({ draftContent: 'unsaved', save: vi.fn(async () => undefined) });
    const send = vi.spyOn(resultController, 'export');
    render(<ExportResultModal document={document} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'startExport' }));
    await screen.findByText('exportSaveRequired');
    expect(send).not.toHaveBeenCalled();
    expect(useResultStore.getState().draftContent).toBe('unsaved');
    expect(useResultStore.getState().activeDocument).toEqual(document);
  });

  it('prevents duplicate starts and cancels the scoped job on unmount', async () => {
    let finish!: (value: ExportResultOutput) => void;
    const send = vi.spyOn(resultController, 'export').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const cancel = vi.spyOn(resultController, 'cancelExport').mockResolvedValue(true);
    const view = render(<ExportResultModal document={document} onClose={() => undefined} />);
    const start = screen.getByRole('button', { name: 'startExport' });
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const input = send.mock.calls[0][0];
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(input.exportId);
    await act(async () => finish({ ...input, status: 'cancelled', fileName: null }));
  });

  it('explains a locked destination and retries without modifying the saved Result', async () => {
    const send = vi
      .spyOn(resultController, 'export')
      .mockRejectedValueOnce({ code: 'FILESYSTEM_ERROR', message: 'filesystem operation failed' })
      .mockImplementationOnce(async (input) => ({
        ...input,
        status: 'completed',
        fileName: 'result.pdf',
      }));
    render(<ExportResultModal document={document} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'startExport' }));
    await screen.findByText('exportDestinationUnavailable');
    expect(useResultStore.getState().activeDocument).toEqual(document);
    fireEvent.click(screen.getByRole('button', { name: 'retryExport' }));
    await screen.findByText('exportMockCompleted');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].exportId).not.toBe(send.mock.calls[1][0].exportId);
    expect(useResultStore.getState().activeDocument).toEqual(document);
  });
});
