import {
  AppstoreOutlined,
  PaperClipOutlined,
  PlusOutlined,
  RedoOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Alert, Button, Input, message, Select, Tag, Tooltip } from 'antd';
import MarkdownIt from 'markdown-it';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ContextManifest, ContextSelection } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { ContextSelector } from '../../context/components/ContextSelector';
import { contextReviewFingerprint, normalizeContextSelection } from '../../context/contextSnapshot';
import {
  buildContextManifestInput,
  createWebMockManifest,
  processingLocationForProvider,
} from '../../context/contextManifest';
import { useImportStore } from '../../imports/importStore';
import { chatController } from '../chatController';
import { errorDetails } from '../../../stores/support';
import styles from './ChatPanel.module.css';

const defaultContext: ContextSelection = {
  selection: false,
  currentFile: true,
  recentMessages: true,
  recentMessageCount: 3,
  projectFiles: [],
};

const markdownRenderer = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

markdownRenderer.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noreferrer noopener');
  return renderer.renderToken(tokens, index, options);
};

function AssistantMarkdown({ content, streaming }: { content: string; streaming: boolean }) {
  const rendered = useMemo(() => markdownRenderer.render(content), [content]);

  return (
    <div className={styles.markdownBubble}>
      <div
        className={styles.markdownContent}
        // Raw HTML is disabled above, so model-provided tags are escaped before rendering.
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
      {streaming && <span className={styles.cursor} />}
    </div>
  );
}

function validationFailureReason(protocolError?: string | null) {
  return protocolError
    ?.replace(/^AI 修改方案未通过安全校验[：:]\s*/, '')
    .replace(/^invalid input:\s*/i, '')
    .trim();
}

function looksLikeUnverifiedFileCompletionClaim(content: string) {
  const clauses = content.split(/[。！？.!?\n]/u).map((clause) => clause.trim().toLowerCase());
  return clauses.some((clause) => {
    if (!clause) return false;
    const mentionsArtifact = [
      '文件',
      '文档',
      '成果',
      'file',
      'document',
      'artifact',
      'result',
    ].some((term) => clause.includes(term));
    const conditionalOrNegative = [
      '如果',
      '假如',
      '若您',
      '尚未',
      '还未',
      '还没有',
      '没有创建',
      '没有生成',
      '没有保存',
      '没有修改',
      '未创建',
      '未生成',
      '未保存',
      '未修改',
      'if ',
      'when ',
      'not created',
      'not generated',
      'not saved',
      'not modified',
      "haven't created",
      'have not created',
      "didn't create",
      'did not create',
    ].some((term) => clause.includes(term));
    const claimsCompletion = [
      '我已创建',
      '我已经创建',
      '我已经为您创建',
      '我已为您创建',
      '我已生成',
      '我已经生成',
      '我已经为您生成',
      '我已为您生成',
      '我已保存',
      '我已经保存',
      '我已修改',
      '我已经修改',
      '我已写入',
      '我已经写入',
      '已经创建完成',
      '已创建完成',
      '创建完成',
      '已经成功写入',
      'i created',
      "i've created",
      'i have created',
      'i generated',
      "i've generated",
      'i have generated',
      'i saved',
      "i've saved",
      'i have saved',
      'i modified',
      "i've modified",
      'i have modified',
      'has been created',
      'has been saved',
      'has been modified',
    ].some((term) => clause.includes(term));
    return mentionsArtifact && claimsCompletion && !conditionalOrNegative;
  });
}

interface ChatPanelProps {
  professionalTools?: boolean;
}

export function ChatPanel({ professionalTools = true }: ChatPanelProps) {
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
  const chatError = useAppStore((state) => state.chatError);
  const pendingDiff = useAppStore((state) => state.pendingDiff);
  const setCenterView = useAppStore((state) => state.setCenterView);
  const createSession = useAppStore((state) => state.createSession);
  const selectSession = useAppStore((state) => state.selectSession);
  const sendChat = useAppStore((state) => state.sendChat);
  const stopChat = useAppStore((state) => state.stopChat);
  const contextBySession = useAppStore((state) => state.contextBySession);
  const contextReviewKeyBySession = useAppStore((state) => state.contextReviewKeyBySession);
  const setSessionContext = useAppStore((state) => state.setSessionContext);
  const setSessionContextReviewKey = useAppStore((state) => state.setSessionContextReviewKey);
  const addFileToContext = useAppStore((state) => state.addFileToContext);
  const addFile = useAppStore((state) => state.addFile);
  const documentSources = useImportStore((state) => state.sources);
  const loadDocumentSources = useImportStore((state) => state.loadSources);
  const [prompt, setPrompt] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [contextIntent, setContextIntent] = useState<'review' | 'send'>('send');
  const [dragging, setDragging] = useState(false);
  const [plannedManifest, setPlannedManifest] = useState<ContextManifest | null>(null);
  const [plannedProviderKey, setPlannedProviderKey] = useState('');
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
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
  const visibleManifest = plannedProviderKey === providerKey ? plannedManifest : null;
  const visibleManifestError = plannedProviderKey === providerKey ? manifestError : null;
  const effectiveContext = useMemo(
    () => normalizeContextSelection(savedContext ?? defaultContext, selectedText),
    [savedContext, selectedText]
  );
  const currentContextFingerprint = useMemo(
    () =>
      contextReviewFingerprint({ selection: effectiveContext, files, activePath, selectedText }),
    [activePath, effectiveContext, files, selectedText]
  );
  const currentContextReviewKey = JSON.stringify([providerKey, currentContextFingerprint]);
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
    endRef.current?.scrollIntoView({ behavior: chatRequestId ? 'auto' : 'smooth' });
  }, [activeSession?.messages, chatRequestId]);

  useEffect(() => {
    if (workspace?.id && runtimeMode === 'desktop') void loadDocumentSources(workspace.id);
  }, [loadDocumentSources, runtimeMode, workspace?.id]);

  const sendNow = (request: string, selection: ContextSelection, manifestId: string) => {
    setSessionContext(activeSessionId, selection);
    setPrompt('');
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
    setManifestLoading(true);
    setManifestError(null);
    try {
      const manifest = await createContextManifest(request, normalized);
      if (!manifest) return;
      if (manifest.requiresSensitiveConfirmation) {
        setPlannedManifest(manifest);
        setPlannedProviderKey(providerKey);
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
    if (!hasReviewedContext) {
      setContextIntent('send');
      setPlannedManifest(null);
      setPlannedProviderKey('');
      setManifestError(null);
      setContextOpen(true);
      return;
    }
    if (!contextReviewed) {
      message.info(t('contextChangePrompt'));
      return;
    }
    if (visibleManifest?.requiresSensitiveConfirmation) {
      message.info(t('sensitiveContextChangePrompt'));
      return;
    }
    if (!reviewedContextKey && sessionHasSentMessage) {
      setSessionContextReviewKey(activeSessionId, currentContextReviewKey);
    }
    void sendWithReviewedContext(request);
  };

  const planContext = async (selection: ContextSelection) => {
    if (!activeSession || !prompt.trim()) return;
    const normalized = normalizeContextSelection(selection, selectedText);
    setManifestLoading(true);
    setManifestError(null);
    setPlannedProviderKey(providerKey);
    try {
      const manifest = await createContextManifest(prompt.trim(), normalized);
      if (!manifest) return;
      setSessionContext(activeSessionId, normalized);
      setPlannedManifest(manifest);
      setPlannedProviderKey(providerKey);
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
    const fingerprint = contextReviewFingerprint({
      selection: normalized,
      files,
      activePath,
      selectedText,
    });
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
      setPlannedManifest(null);
      setPlannedProviderKey('');
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
    setPrompt(previous.content);
    requestSend(previous.content);
  };

  const addDroppedFiles = async (fileList: FileList) => {
    const supported = /\.(txt|md|json|ts|tsx|js|jsx|py|ya?ml|css|html|xml|toml|ini|sql|sh|ps1)$/i;
    for (const file of Array.from(fileList)) {
      if (!supported.test(file.name) || file.size > 2 * 1024 * 1024) {
        message.warning(`${file.name}: ${t('unsupportedFile')}`);
        continue;
      }
      const path = `uploads/${file.name}`;
      addFile({
        path,
        name: file.name,
        language: file.name.split('.').pop() ?? 'text',
        content: await file.text(),
      });
      addFileToContext(activeSessionId, path);
    }
  };

  return (
    <aside className={styles.panel} aria-label={t('assistant')}>
      <header className={styles.header}>
        <div>
          <strong>{t('assistant')}</strong>
          <span>
            <i className={activeProvider?.configured ? styles.online : styles.offline} />
            {professionalTools
              ? activeProvider
                ? `${activeProvider.id} · ${activeProvider.model}`
                : t('providerNotConfigured')
              : t(activeProvider?.configured ? 'assistantReady' : 'assistantSetupNeeded')}
          </span>
        </div>
        {professionalTools ? (
          <Tooltip title={t('newSession')}>
            <Button
              type="text"
              aria-label={t('newSession')}
              icon={<PlusOutlined />}
              onClick={() => void createSession()}
            />
          </Tooltip>
        ) : (
          <Button
            size="small"
            aria-label={t('newConversation')}
            icon={<PlusOutlined />}
            onClick={() => void createSession()}
          >
            {t('newConversation')}
          </Button>
        )}
      </header>
      {professionalTools ? (
        <Select
          value={activeSessionId || undefined}
          onChange={selectSession}
          options={sessions.map((session) => ({ value: session.id, label: session.title }))}
          className={styles.sessionSelect}
          placeholder={t('newSession')}
        />
      ) : null}
      {chatError && <Alert className={styles.chatError} type="error" showIcon title={chatError} />}
      <div className={styles.messages} aria-live="polite">
        {activeSession?.messages.map((chatMessage, index) => {
          const containsPatchProtocol =
            chatMessage.role === 'assistant' &&
            chatMessage.content.toLowerCase().includes('document_patch');
          const containsA2uiProtocol =
            chatMessage.role === 'assistant' && /a2ui_(surface|update)/i.test(chatMessage.content);
          const patchFailed = chatMessage.errorCode === 'PATCH_VALIDATION_FAILED';
          const patchFailureReason = validationFailureReason(chatMessage.protocolError);
          const emptyFilePatchUnsupported = patchFailureReason?.startsWith('目标文件为空');
          const a2uiFailed = chatMessage.errorCode === 'A2UI_VALIDATION_FAILED';
          const unverifiedCompletionClaim =
            chatMessage.errorCode === 'UNVERIFIED_FILE_COMPLETION_CLAIM' ||
            (chatMessage.role === 'assistant' &&
              chatMessage.status === 'complete' &&
              !containsPatchProtocol &&
              !containsA2uiProtocol &&
              looksLikeUnverifiedFileCompletionClaim(chatMessage.content));
          const fileCreationUnavailable = chatMessage.errorCode === 'FILE_CREATION_NOT_AVAILABLE';
          const patchGenerating = containsPatchProtocol && chatMessage.status === 'streaming';
          const a2uiGenerating = containsA2uiProtocol && chatMessage.status === 'streaming';
          return (
            <article
              key={chatMessage.id}
              className={`${styles.message} ${chatMessage.role === 'user' ? styles.user : styles.assistant}`}
            >
              <div className={styles.role}>{chatMessage.role === 'user' ? 'YOU' : 'A2UI'}</div>
              {fileCreationUnavailable ? (
                <div className={styles.protocolError}>
                  <Alert
                    type="info"
                    showIcon
                    title={t('fileCreationUnavailable')}
                    description={t('fileCreationUnavailableDescription')}
                  />
                </div>
              ) : a2uiGenerating ? (
                <div className={styles.protocolError}>
                  <Alert type="info" showIcon title={t('a2uiGenerating')} />
                </div>
              ) : containsA2uiProtocol ? (
                <div className={styles.protocolError}>
                  <Alert
                    type={a2uiFailed ? 'warning' : 'success'}
                    showIcon
                    title={t(a2uiFailed ? 'a2uiValidationFailed' : 'a2uiReady')}
                    description={
                      a2uiFailed ? t('a2uiValidationFailedDescription') : t('a2uiReadyDescription')
                    }
                  />
                  <Button type="link" onClick={() => setCenterView('surface')}>
                    {t(a2uiFailed ? 'openInspector' : 'openSurface')}
                  </Button>
                </div>
              ) : patchGenerating ? (
                <div className={styles.protocolError}>
                  <Alert
                    type="info"
                    showIcon
                    title={t('patchGenerating')}
                    description={t('patchGeneratingDescription')}
                  />
                </div>
              ) : containsPatchProtocol ? (
                <div className={styles.protocolError}>
                  <Alert
                    type={patchFailed ? 'warning' : 'info'}
                    showIcon
                    title={t(patchFailed ? 'patchValidationFailed' : 'patchProtocolReceived')}
                    description={
                      patchFailed ? (
                        <div>
                          <div>
                            {t(
                              emptyFilePatchUnsupported
                                ? 'emptyFilePatchUnsupportedDescription'
                                : 'patchValidationFailedDescription'
                            )}
                          </div>
                          {patchFailureReason ? (
                            <div className={styles.validationDetail}>
                              <strong>{t('validationFailureReason')}</strong>
                              <span>{patchFailureReason}</span>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        t('patchProtocolReceivedDescription')
                      )
                    }
                  />
                  {!patchFailed && pendingDiff ? (
                    <Button type="link" onClick={() => setCenterView('diff')}>
                      {t('openReviewCenter')}
                    </Button>
                  ) : null}
                </div>
              ) : unverifiedCompletionClaim ? (
                <div className={styles.protocolError}>
                  <Alert
                    type="warning"
                    showIcon
                    title={t('unverifiedCompletionClaim')}
                    description={t('unverifiedCompletionClaimDescription')}
                  />
                </div>
              ) : chatMessage.role === 'assistant' ? (
                <AssistantMarkdown
                  content={
                    chatMessage.content ||
                    (chatMessage.status === 'streaming' ? t('waitingForProvider') : '')
                  }
                  streaming={chatMessage.status === 'streaming'}
                />
              ) : (
                <p className={styles.plainBubble}>{chatMessage.content}</p>
              )}
              {(chatMessage.status === 'error' ||
                chatMessage.status === 'stopped' ||
                (patchFailed && !emptyFilePatchUnsupported) ||
                a2uiFailed) && (
                <Button
                  size="small"
                  type="link"
                  icon={<RedoOutlined />}
                  onClick={() => retryMessage(index)}
                >
                  {t('retry')}
                </Button>
              )}
            </article>
          );
        })}
        <div ref={endRef} />
      </div>
      <div
        className={`${styles.composer} ${dragging ? styles.dragging : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void addDroppedFiles(event.dataTransfer.files);
        }}
      >
        <div className={styles.contextBar}>
          <Button
            type="text"
            size="small"
            icon={<AppstoreOutlined />}
            onClick={() => {
              const needsTrustedSendReview = Boolean(
                prompt.trim() &&
                (!contextReviewed || visibleManifest?.requiresSensitiveConfirmation)
              );
              setContextIntent(needsTrustedSendReview ? 'send' : 'review');
              if (!visibleManifest?.requiresSensitiveConfirmation) {
                setPlannedManifest(null);
                setPlannedProviderKey('');
              }
              setManifestError(null);
              setContextOpen(true);
            }}
          >
            {t(hasReviewedContext ? 'modifySendList' : 'context')}
          </Button>
          {activePath && <Tag color="blue">{activePath}</Tag>}
          {(savedContext?.projectFiles ?? []).map((path) => (
            <Tag key={path}>{path}</Tag>
          ))}
          <Tag color={contextReviewed ? 'green' : 'orange'}>
            {t(
              contextReviewed
                ? 'contextSaved'
                : hasReviewedContext
                  ? 'contextChanged'
                  : 'contextRequired'
            )}
          </Tag>
          <Tag color={processingLocation === 'local' ? 'green' : 'gold'}>
            {t(processingLocation === 'local' ? 'localProcessing' : 'cloudProcessing')}
          </Tag>
          <Tooltip title={t('dropFilesHint')}>
            <span className={styles.dropHint}>
              <PaperClipOutlined /> {t('dropFilesShort')}
            </span>
          </Tooltip>
        </div>
        <Input.TextArea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('askPlaceholder')}
          autoSize={{ minRows: 3, maxRows: 7 }}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              requestSend();
            }
          }}
        />
        {chatRequestId ? (
          <Button danger icon={<StopOutlined />} onClick={() => void stopChat()}>
            {t('stop')}
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={!prompt.trim() || manifestLoading}
            loading={manifestLoading && !contextOpen}
            onClick={() => requestSend()}
          >
            {t('send')}
          </Button>
        )}
      </div>
      {contextOpen && (
        <ContextSelector
          open
          prompt={prompt}
          initialSelection={effectiveContext}
          confirmText={contextIntent === 'review' ? t('saveContextSelection') : undefined}
          manifest={visibleManifest}
          planning={manifestLoading}
          error={visibleManifestError}
          processingLocation={processingLocation}
          reviewOnly={contextIntent === 'review'}
          onCancel={() => setContextOpen(false)}
          onPlan={(selection) => void planContext(selection)}
          onInvalidateManifest={() => {
            setPlannedManifest(null);
            setPlannedProviderKey('');
            setManifestError(null);
          }}
          onConfirm={confirmContext}
        />
      )}
    </aside>
  );
}
