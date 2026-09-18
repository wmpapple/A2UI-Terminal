import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import exportFixture from '../../../contracts/v2/export.json';
import contextPackFixture from '../../../contracts/v2/context-pack.json';
import a2uiCapabilities from '../../../contracts/v2/a2ui-capabilities.json';
import searchFixture from '../../../contracts/v2/search.json';
import providerProcessingFixture from '../../../contracts/v2/provider-processing.json';
import telemetryFixture from '../../../contracts/v2/telemetry.json';
import recoveryFixture from '../../../contracts/v2/recovery.json';
import {
  isExportResultInput,
  isExportResultOutput,
  isExportProgressEvent,
  isA2uiProcessResult,
  isA2uiCapabilities,
  isA2uiSurfaceProtocol,
  isAppErrorContract,
  isChatSession,
  isChatStreamEvent,
  isChatStreamResult,
  isDocumentPatch,
  isDocumentSource,
  isDocumentSourceContent,
  isContextManifest,
  isContextPack,
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
  isSearchAuthorizedContentOutput,
  isProcessingOptions,
  isLocalProviderProbe,
  isTelemetryDictionary,
  isTelemetrySettings,
  isRecoveryStatus,
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
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });
  it('keeps export input opaque and sends a typed progress Channel', async () => {
    expect(isExportResultInput(exportFixture.input)).toBe(true);
    expect(isExportResultOutput(exportFixture.output)).toBe(true);
    expect(isExportProgressEvent(exportFixture.event)).toBe(true);
    expect(isExportResultInput({ ...exportFixture.input, path: '/untrusted' })).toBe(false);
    expect(isExportProgressEvent({ ...exportFixture.event, progress: 101 })).toBe(false);
    expect(isExportResultOutput({ ...exportFixture.output, status: 'unknown' })).toBe(false);
    const original = window.__TAURI_INTERNALS__;
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    try {
      if (!isExportResultInput(exportFixture.input)) throw new Error('Invalid fixture');
      invokeMock.mockResolvedValueOnce(exportFixture.output);
      const handler = vi.fn();
      expect(await desktopApi.exportResult(exportFixture.input, handler)).toEqual(
        exportFixture.output
      );
      const [command, payload] = invokeMock.mock.calls.at(-1)!;
      expect(command).toBe('export_result');
      expect(Object.keys(payload).sort()).toEqual(['input', 'onEvent']);
      expect(payload.input).toEqual(exportFixture.input);
      payload.onEvent.onmessage(exportFixture.event);
      expect(handler).toHaveBeenCalledWith(exportFixture.event);
    } finally {
      Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: original });
    }
  });
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
    expect(isA2uiCapabilities(a2uiCapabilities)).toBe(true);
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
    expect(isContextPack(contextPackFixture.pack)).toBe(true);
    expect(isSearchAuthorizedContentOutput(searchFixture.output)).toBe(true);
    expect(isProcessingOptions(providerProcessingFixture.processingOptions)).toBe(true);
    expect(providerProcessingFixture.localProbes.every(isLocalProviderProbe)).toBe(true);
    expect(isTelemetrySettings(telemetryFixture.settings)).toBe(true);
    expect(isTelemetryDictionary(telemetryFixture.dictionary)).toBe(true);
    expect(isRecoveryStatus(recoveryFixture)).toBe(true);
    expect(JSON.stringify(recoveryFixture)).not.toContain('targetPath');
    expect(JSON.stringify(recoveryFixture)).not.toContain('absolutePath');
    expect(isReviewRequest(review.request)).toBe(true);
    expect(isReviewApplication(review.application)).toBe(true);
  });

  it('uses read-only local processing commands without sending endpoint input', async () => {
    const original = window.__TAURI_INTERNALS__;
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    try {
      invokeMock.mockResolvedValueOnce(providerProcessingFixture.processingOptions);
      await expect(desktopApi.getProcessingOptions()).resolves.toEqual(
        providerProcessingFixture.processingOptions
      );
      expect(invokeMock).toHaveBeenLastCalledWith('get_processing_options');
      invokeMock.mockResolvedValueOnce(providerProcessingFixture.localProbes);
      await expect(desktopApi.probeLocalProviders()).resolves.toEqual(
        providerProcessingFixture.localProbes
      );
      expect(invokeMock).toHaveBeenLastCalledWith('probe_local_providers');
    } finally {
      Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: original });
    }
  });

  it('keeps telemetry default-off and exposes the dictionary without content input', async () => {
    const original = window.__TAURI_INTERNALS__;
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    try {
      invokeMock.mockResolvedValueOnce(telemetryFixture.settings);
      await expect(desktopApi.getTelemetrySettings()).resolves.toEqual(telemetryFixture.settings);
      expect(invokeMock).toHaveBeenLastCalledWith('get_telemetry_settings');

      invokeMock.mockResolvedValueOnce(telemetryFixture.dictionary);
      await expect(desktopApi.exportEventDictionary()).resolves.toEqual(
        telemetryFixture.dictionary
      );
      expect(invokeMock).toHaveBeenLastCalledWith('export_event_dictionary');

      invokeMock.mockResolvedValueOnce({ ...telemetryFixture.settings, enabled: true });
      await desktopApi.setTelemetrySettings({ enabled: true });
      expect(invokeMock).toHaveBeenLastCalledWith('set_telemetry_settings', {
        input: { enabled: true },
      });
    } finally {
      Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: original });
    }
  });

  it('keeps authorized search IPC free of paths and raw content', async () => {
    const original = window.__TAURI_INTERNALS__;
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    try {
      invokeMock.mockResolvedValueOnce(searchFixture.output);
      await expect(desktopApi.searchAuthorizedContent(searchFixture.input)).resolves.toEqual(
        searchFixture.output
      );
      expect(invokeMock).toHaveBeenLastCalledWith('search_authorized_content', {
        input: searchFixture.input,
      });
      invokeMock.mockResolvedValueOnce(searchFixture.rebuildOutput);
      await expect(desktopApi.rebuildAuthorizedSearchIndex()).resolves.toEqual(
        searchFixture.rebuildOutput
      );
      expect(invokeMock).toHaveBeenLastCalledWith('rebuild_authorized_search_index');
    } finally {
      Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: original });
    }
  });

  it('keeps Context Pack IPC scoped to opaque workspace and source identifiers', async () => {
    expect(isContextPack(contextPackFixture.pack)).toBe(true);
    expect(
      isContextPack({
        ...contextPackFixture.pack,
        items: new Array(21).fill({ sourceId: 'x', label: 'x' }),
      })
    ).toBe(false);
    const original = window.__TAURI_INTERNALS__;
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    try {
      invokeMock.mockResolvedValueOnce(contextPackFixture.pack);
      await expect(desktopApi.createContextPack(contextPackFixture.createInput)).resolves.toEqual(
        contextPackFixture.pack
      );
      expect(invokeMock).toHaveBeenLastCalledWith('create_context_pack', {
        input: contextPackFixture.createInput,
      });
      invokeMock.mockResolvedValueOnce(contextPackFixture.deleteOutput);
      await expect(
        desktopApi.deleteContextPack(
          contextPackFixture.pack.workspaceId,
          contextPackFixture.pack.id
        )
      ).resolves.toEqual(contextPackFixture.deleteOutput);
      expect(invokeMock).toHaveBeenLastCalledWith('delete_context_pack', {
        workspaceId: contextPackFixture.pack.workspaceId,
        packId: contextPackFixture.pack.id,
      });
    } finally {
      Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: original });
    }
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
      invokeMock.mockReset();
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        configurable: true,
        value: tauriInternals,
      });
    }
  });
});
