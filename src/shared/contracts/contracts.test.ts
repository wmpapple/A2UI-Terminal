import { describe, expect, it, vi } from 'vitest';
import workspace from '../../../contracts/v1/workspace.json';
import chat from '../../../contracts/v1/chat.json';
import patch from '../../../contracts/v1/patch.json';
import a2ui from '../../../contracts/v1/a2ui.json';
import revision from '../../../contracts/v1/revision.json';
import error from '../../../contracts/v1/error.json';
import result from '../../../contracts/v2/result.json';
import task from '../../../contracts/v2/task.json';
import importBatch from '../../../contracts/v2/import.json';
import importDrop from '../../../contracts/v2/import-drop.json';
import documentSource from '../../../contracts/v2/document-source.json';
import contextManifest from '../../../contracts/v2/context-manifest.json';
import review from '../../../contracts/v2/review.json';
import {
  isA2uiProcessResult,
  isA2uiSurfaceProtocol,
  isAppErrorContract,
  isChatSession,
  isChatStreamEvent,
  isChatStreamResult,
  isDocumentPatch,
  isDocumentSource,
  isDocumentSourceContent,
  isContextManifest,
  isDocumentVersion,
  isDocumentVersionSummary,
  isImportBatch,
  isImportDropOutcome,
  isPatchApplication,
  isPatchReview,
  isWorkspaceDocument,
  isResultDetail,
  isResultDocument,
  isResultRevision,
  isResultSummary,
  isReviewApplication,
  isReviewRequest,
  isTaskDetail,
  isTaskRunResult,
  isTaskTemplate,
} from './guards';
import { desktopApi } from '../platform/desktop';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    onmessage?: (event: unknown) => void;
  },
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

describe('shared Rust/TypeScript contract fixtures', () => {
  it('accepts the five domain response fixtures and stable error envelope', () => {
    expect(isWorkspaceDocument(workspace)).toBe(true);
    expect(isChatSession(chat.session)).toBe(true);
    expect(isChatStreamEvent(chat.streamEvent)).toBe(true);
    expect(isChatStreamResult(chat.streamResult)).toBe(true);
    expect(isDocumentPatch(patch.protocol)).toBe(true);
    expect(isPatchReview(patch.review)).toBe(true);
    expect(isPatchApplication(patch.application)).toBe(true);
    expect(isA2uiSurfaceProtocol(a2ui.protocol)).toBe(true);
    expect(isA2uiProcessResult(a2ui.processResult)).toBe(true);
    expect(isDocumentVersionSummary(revision.summary)).toBe(true);
    expect(isDocumentVersion(revision.document)).toBe(true);
    expect(isAppErrorContract(error)).toBe(true);
    expect(isResultSummary(result.summary)).toBe(true);
    expect(isResultDetail(result.detail)).toBe(true);
    expect(isResultDocument(result.document)).toBe(true);
    expect(result.typedDocuments).toHaveLength(4);
    expect(result.typedDocuments.every(isResultDocument)).toBe(true);
    expect(isResultRevision(result.revision)).toBe(true);
    expect(isTaskTemplate(task.template)).toBe(true);
    expect(isTaskDetail(task.task)).toBe(true);
    expect(isTaskRunResult(task.runResult)).toBe(true);
    expect(isImportBatch(importBatch)).toBe(true);
    expect(isImportDropOutcome(importDrop)).toBe(true);
    expect(isDocumentSource(documentSource.source)).toBe(true);
    expect(isDocumentSourceContent(documentSource)).toBe(true);
    expect(isContextManifest(contextManifest)).toBe(true);
    expect(isReviewRequest(review.request)).toBe(true);
    expect(isReviewApplication(review.application)).toBe(true);
  });

  it('allows additive fields on trusted Rust responses for forward compatibility', () => {
    expect(isWorkspaceDocument({ ...workspace, futureField: 'allowed' })).toBe(true);
    expect(isChatSession({ ...chat.session, futureField: 'allowed' })).toBe(true);
    expect(isDocumentVersion({ ...revision.document, futureField: 'allowed' })).toBe(true);
    expect(isResultDetail({ ...result.detail, futureField: 'allowed' })).toBe(true);
    expect(isTaskDetail({ ...task.task, futureField: 'allowed' })).toBe(true);
    expect(isImportBatch({ ...importBatch, futureField: 'allowed' })).toBe(true);
    expect(isContextManifest({ ...contextManifest, futureField: 'allowed' })).toBe(true);
  });

  it('rejects unknown fields on untrusted Patch and A2UI protocol inputs', () => {
    expect(isDocumentPatch({ ...patch.protocol, futureField: 'rejected' })).toBe(false);
    expect(isA2uiSurfaceProtocol({ ...a2ui.protocol, futureField: 'rejected' })).toBe(false);
  });

  it('keeps Web Mock contract checks away from the Desktop invoke boundary', async () => {
    const tauriInternals = window.__TAURI_INTERNALS__;
    const tauriIpc = window.__TAURI_IPC__;
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, '__TAURI_IPC__', {
      configurable: true,
      value: undefined,
    });

    await expect(desktopApi.listRecentWorkspaces()).rejects.toThrow(
      'Desktop API is unavailable in Web Mock mode.'
    );
    expect(invokeMock).not.toHaveBeenCalled();

    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: tauriInternals,
    });
    Object.defineProperty(window, '__TAURI_IPC__', {
      configurable: true,
      value: tauriIpc,
    });
  });

  it('subscribes to the sanitized native-drop event in Desktop mode', async () => {
    const tauriInternals = window.__TAURI_INTERNALS__;
    const stopListening = vi.fn();
    listenMock.mockResolvedValue(stopListening);
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });

    try {
      const handler = vi.fn();
      await expect(desktopApi.listenImportDropOutcomes(handler)).resolves.toBe(stopListening);
      expect(listenMock).toHaveBeenCalledWith('import-drop-outcome', expect.any(Function));
      const listener = listenMock.mock.calls[0][1] as (event: { payload: unknown }) => void;
      listener({ payload: importDrop });
      expect(handler).toHaveBeenCalledWith(importDrop);
    } finally {
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        configurable: true,
        value: tauriInternals,
      });
    }
  });
});
