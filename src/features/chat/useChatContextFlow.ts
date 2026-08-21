import { message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import type { ContextManifest, ContextSelection } from '../../shared/types/domain';
import { errorDetails } from '../../stores/support';
import { useAppStore } from '../../stores/useAppStore';
import {
  contentFingerprint,
  contextReviewFingerprint,
  normalizeContextSelection,
} from '../context/contextSnapshot';
import {
  buildContextManifestInput,
  createWebMockManifest,
  processingLocationForProvider,
} from '../context/contextManifest';
import { useImportStore } from '../imports/importStore';
import { chatController } from './chatController';

const defaultContext: ContextSelection = {
  selection: false,
  currentFile: true,
  recentMessages: true,
  recentMessageCount: 3,
  projectFiles: [],
};

type ContextIntent = 'review' | 'send';

export function useChatContextFlow() {
  const { t } = useI18n();
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activePath = useAppStore((state) => state.activePath);
  const files = useAppStore((state) => state.files);
  const workspace = useAppStore((state) => state.workspace);
  const runtimeMode = useAppStore((state) => state.runtimeMode);
  const selectedText = useAppStore((state) => state.selectedText);
  const providerConfigs = useAppStore((state) => state.providerConfigs);
  const activeProviderId = useAppStore((state) => state.activeProviderId);
  const chatRequestId = useAppStore((state) => state.chatRequestId);
  const contextBySession = useAppStore((state) => state.contextBySession);
  const contextReviewKeyBySession = useAppStore((state) => state.contextReviewKeyBySession);
  const setSessionContext = useAppStore((state) => state.setSessionContext);
  const setSessionContextReviewKey = useAppStore((state) => state.setSessionContextReviewKey);
  const sendChat = useAppStore((state) => state.sendChat);
  const documentSources = useImportStore((state) => state.sources);
  const loadDocumentSources = useImportStore((state) => state.loadSources);
  const [prompt, setPrompt] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [contextIntent, setContextIntent] = useState<ContextIntent>('send');
  const [plannedManifest, setPlannedManifest] = useState<ContextManifest | null>(null);
  const [plannedManifestKey, setPlannedManifestKey] = useState('');
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions]
  );
  const savedContext = contextBySession[activeSessionId];
  const activeProvider = providerConfigs.find((config) => config.id === activeProviderId);
  const processingLocation = processingLocationForProvider(activeProvider);
  const providerKey = JSON.stringify([
    activeProviderId,
    activeProvider?.endpoint,
    activeProvider?.model,
    activeProvider?.proxyUrl,
    activeProvider?.temperature,
  ]);
  const effectiveContext = useMemo(
    () => normalizeContextSelection(savedContext ?? defaultContext, selectedText),
    [savedContext, selectedText]
  );
  const contextFingerprint = (selection: ContextSelection) =>
    contextReviewFingerprint({ selection, files, activePath, selectedText });
  const manifestKey = (request: string, selection: ContextSelection) =>
    JSON.stringify([
      providerKey,
      contextFingerprint(selection),
      contentFingerprint(request.trim()),
    ]);
  const currentContextFingerprint = useMemo(
    () =>
      contextReviewFingerprint({ selection: effectiveContext, files, activePath, selectedText }),
    [activePath, effectiveContext, files, selectedText]
  );
  const currentContextReviewKey = JSON.stringify([providerKey, currentContextFingerprint]);
  const currentManifestKey = manifestKey(prompt, effectiveContext);
  const visibleManifest = plannedManifestKey === currentManifestKey ? plannedManifest : null;
  const visibleManifestError = plannedManifestKey === currentManifestKey ? manifestError : null;
  const reviewedContextKey = contextReviewKeyBySession[activeSessionId];
  const sessionHasSentMessage =
    activeSession?.messages.some((chatMessage) => chatMessage.role === 'user') ?? false;
  const hasReviewedContext = Boolean(reviewedContextKey) || sessionHasSentMessage;
  const contextReviewed = hasReviewedContext
    ? reviewedContextKey
      ? reviewedContextKey === currentContextReviewKey
      : true
    : false;

  useEffect(() => {
    if (workspace?.id && runtimeMode === 'desktop') void loadDocumentSources(workspace.id);
  }, [loadDocumentSources, runtimeMode, workspace?.id]);

  const invalidateManifest = () => {
    setPlannedManifest(null);
    setPlannedManifestKey('');
    setManifestError(null);
  };

  const updatePrompt = (nextPrompt: string) => {
    setPrompt(nextPrompt);
    invalidateManifest();
  };

  const sendNow = (request: string, selection: ContextSelection, manifestId: string) => {
    setSessionContext(activeSessionId, selection);
    setPrompt('');
    invalidateManifest();
    void sendChat(request, manifestId);
  };

  const createContextManifest = async (request: string, selection: ContextSelection) => {
    if (!activeSession) return null;
    const normalized = normalizeContextSelection(selection, selectedText);
    const workspaceId = workspace?.id ?? 'web-mock-workspace';
    const input = buildContextManifestInput({
      workspaceId,
      sessionId: activeSession.id,
      providerId: activeProviderId,
      prompt: request,
      selection: normalized,
      files,
      documentSources: documentSources.filter((source) => source.workspaceId === workspaceId),
      activePath,
      selectedText,
    });
    return runtimeMode === 'web-mock'
      ? createWebMockManifest(input, processingLocation)
      : chatController.planContext(input);
  };

  const sendWithReviewedContext = async (request: string) => {
    const normalized = normalizeContextSelection(effectiveContext, selectedText);
    const requestManifestKey = manifestKey(request, normalized);
    setManifestLoading(true);
    setManifestError(null);
    try {
      const manifest = await createContextManifest(request, normalized);
      if (!manifest) return;
      if (manifest.requiresSensitiveConfirmation) {
        setPlannedManifest(manifest);
        setPlannedManifestKey(requestManifestKey);
        message.info(t('sensitiveContextChangePrompt'));
        return;
      }
      if (runtimeMode === 'desktop') {
        await chatController.confirmContext(manifest.id, false);
      }
      sendNow(request, normalized, manifest.id);
    } catch (error) {
      const details = errorDetails(error);
      setManifestError(details.message);
      message.error(details.message);
    } finally {
      setManifestLoading(false);
    }
  };

  const requestSend = (requestOverride?: string) => {
    const request = (requestOverride ?? prompt).trim();
    if (!request || chatRequestId || manifestLoading || !activeSession) return;
    const requestManifest =
      plannedManifestKey === manifestKey(request, effectiveContext) ? plannedManifest : null;
    if (!hasReviewedContext) {
      setContextIntent('send');
      invalidateManifest();
      setContextOpen(true);
      return;
    }
    if (!contextReviewed) {
      message.info(t('contextChangePrompt'));
      return;
    }
    if (requestManifest?.requiresSensitiveConfirmation) {
      message.info(t('sensitiveContextChangePrompt'));
      return;
    }
    if (!reviewedContextKey && sessionHasSentMessage) {
      setSessionContextReviewKey(activeSessionId, currentContextReviewKey);
    }
    void sendWithReviewedContext(request);
  };

  const planContext = async (selection: ContextSelection) => {
    const request = prompt.trim();
    if (!activeSession || !request) return;
    const normalized = normalizeContextSelection(selection, selectedText);
    const requestManifestKey = manifestKey(request, normalized);
    setManifestLoading(true);
    setManifestError(null);
    setPlannedManifestKey(requestManifestKey);
    try {
      const manifest = await createContextManifest(request, normalized);
      if (!manifest) return;
      setSessionContext(activeSessionId, normalized);
      setPlannedManifest(manifest);
      setPlannedManifestKey(requestManifestKey);
    } catch (error) {
      setManifestError(errorDetails(error).message);
    } finally {
      setManifestLoading(false);
    }
  };

  const confirmContext = async (
    selection: ContextSelection,
    manifestId: string | null,
    sensitiveConfirmed: boolean
  ) => {
    const normalized = normalizeContextSelection(selection, selectedText);
    const fingerprint = contextFingerprint(normalized);
    setSessionContext(activeSessionId, normalized);
    setSessionContextReviewKey(activeSessionId, JSON.stringify([providerKey, fingerprint]));
    if (contextIntent === 'review' || !manifestId) {
      setContextOpen(false);
      return;
    }
    const request = prompt.trim();
    if (!request) return;
    setManifestLoading(true);
    setManifestError(null);
    try {
      if (runtimeMode === 'desktop') {
        await chatController.confirmContext(manifestId, sensitiveConfirmed);
      }
      setContextOpen(false);
      sendNow(request, normalized, manifestId);
    } catch (error) {
      setManifestError(errorDetails(error).message);
    } finally {
      setManifestLoading(false);
    }
  };

  const retryMessage = (messageIndex: number) => {
    const previous = activeSession?.messages
      .slice(0, messageIndex)
      .reverse()
      .find((item) => item.role === 'user');
    if (!previous) return;
    updatePrompt(previous.content);
    requestSend(previous.content);
  };

  const openContext = () => {
    const needsTrustedSendReview = Boolean(
      prompt.trim() && (!contextReviewed || visibleManifest?.requiresSensitiveConfirmation)
    );
    setContextIntent(needsTrustedSendReview ? 'send' : 'review');
    if (!visibleManifest?.requiresSensitiveConfirmation) invalidateManifest();
    else setManifestError(null);
    setContextOpen(true);
  };

  return {
    sessions,
    activeSession,
    activeSessionId,
    activePath,
    activeProvider,
    savedContext,
    effectiveContext,
    processingLocation,
    prompt,
    updatePrompt,
    contextOpen,
    contextIntent,
    closeContext: () => setContextOpen(false),
    openContext,
    hasReviewedContext,
    contextReviewed,
    visibleManifest,
    visibleManifestError,
    manifestLoading,
    requestSend,
    retryMessage,
    planContext,
    confirmContext,
    invalidateManifest,
  };
}
