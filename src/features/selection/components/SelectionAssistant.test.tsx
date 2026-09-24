import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useAppStore } from '../../../stores/useAppStore';
import type { DocumentSnapshot } from '../../../shared/types/document';
import { SelectionAssistant } from './SelectionAssistant';
import { inlineEditController } from '../inlineEditController';

const text = '需要润色的段落';
const snapshot: DocumentSnapshot = {
  target: { kind: 'result', resultId: 'result-1' },
  revisionId: 'revision-1',
  contentHash: 'hash',
  format: 'markdown',
  text,
  editable: true,
  hasUnsavedDraft: false,
};
const port = { read: () => ({ text, start: 0, end: text.length }) };

describe('SelectionAssistant', () => {
  beforeEach(() => {
    useAppStore.setState({
      runtimeMode: 'web-mock',
      activeProviderId: 'local',
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('does not render without an active source selection', () => {
    render(
      <I18nProvider>
        <SelectionAssistant
          editorPort={port}
          snapshot={snapshot}
          selectedText=""
          onApplied={vi.fn()}
        />
      </I18nProvider>
    );
    expect(screen.queryByLabelText(/选区/)).not.toBeInTheDocument();
  });

  it('offers every low-risk inline edit action', () => {
    render(
      <I18nProvider>
        <SelectionAssistant
          editorPort={port}
          snapshot={snapshot}
          selectedText={text}
          onApplied={vi.fn()}
        />
      </I18nProvider>
    );
    for (const label of ['润色', '缩短', '扩写', '专业', '自然', '语法', '翻译']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('does not submit a custom action while IME composition is active', () => {
    render(
      <I18nProvider>
        <SelectionAssistant
          editorPort={port}
          snapshot={snapshot}
          selectedText={text}
          onApplied={vi.fn()}
        />
      </I18nProvider>
    );
    const input = screen.getByRole('textbox', { name: '自定义选区修改' });
    fireEvent.change(input, { target: { value: '改成主动语态' } });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, isComposing: true });
    expect(screen.getByRole('button', { name: '修改' })).not.toBeDisabled();
  });

  it('creates an inline proposal and applies it only after acceptance', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const contentHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const currentSnapshot = { ...snapshot, contentHash };
    useAppStore.setState({ runtimeMode: 'desktop' });
    const review = {
      id: 'review-1',
      workspaceId: 'workspace-1',
      resultId: 'result-1',
      source: 'selection' as const,
      operationKind: 'replace_result' as const,
      status: 'pending' as const,
      summary: '选区内 AI 修改',
      risk: 'low' as const,
      baseRevisionId: 'revision-1',
      baseHash: contentHash,
      blocks: [
        {
          id: 'block-1',
          kind: 'replace_result' as const,
          status: 'pending' as const,
          targetLabel: '结果',
          operation: 'replace_selection',
          before: text,
          after: '润色后的段落',
          reason: '润色',
          risk: 'low' as const,
          suggestedFileName: null,
          decidedFileName: null,
        },
      ],
      applicationOperationId: null,
      outputResultId: null,
      errorCode: null,
      createdAt: '2026-09-24T00:00:00Z',
      decidedAt: null,
      appliedAt: null,
    };
    const plan = vi.spyOn(inlineEditController, 'plan').mockResolvedValue({
      id: 'plan-1',
      requestId: 'request-1',
      manifest: {
        providerId: 'local',
        requiresSensitiveConfirmation: false,
      },
    } as never);
    vi.spyOn(inlineEditController, 'confirm').mockResolvedValue({} as never);
    vi.spyOn(inlineEditController, 'start').mockImplementation(async () => ({
      review,
      selection: plan.mock.calls[0][0].selection,
      replacement: '润色后的段落',
    }));
    const application = {
      reviewId: review.id,
      status: 'applied' as const,
      operationId: null,
      files: [],
      result: null,
    };
    vi.spyOn(inlineEditController, 'accept').mockResolvedValue(application);
    const onApplied = vi.fn();

    render(
      <I18nProvider>
        <SelectionAssistant
          editorPort={port}
          snapshot={currentSnapshot}
          selectedText={text}
          onApplied={onApplied}
        />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: '润色' }));
    expect(await screen.findByText('润色后的段落')).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /接\s*受/ }));
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledWith(application));
  });
});
