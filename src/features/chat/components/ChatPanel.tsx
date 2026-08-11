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
import type { ContextSelection } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { ContextSelector } from '../../context/components/ContextSelector';
import {
  buildContextSnapshot,
  contextReviewFingerprint,
  normalizeContextSelection,
  requiresContextReview,
} from '../../context/contextSnapshot';
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

export function ChatPanel() {
  const { t } = useI18n();
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activePath = useAppStore((state) => state.activePath);
  const files = useAppStore((state) => state.files);
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
  const setSessionContext = useAppStore((state) => state.setSessionContext);
  const addFileToContext = useAppStore((state) => state.addFileToContext);
  const addFile = useAppStore((state) => state.addFile);
  const [prompt, setPrompt] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [contextIntent, setContextIntent] = useState<'review' | 'send'>('send');
  const [reviewedContextBySession, setReviewedContextBySession] = useState<Record<string, string>>(
    {}
  );
  const [dragging, setDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions]
  );
  const savedContext = contextBySession[activeSessionId];
  const activeProvider = providerConfigs.find((config) => config.id === activeProviderId);
  const effectiveContext = useMemo(
    () => normalizeContextSelection(savedContext ?? defaultContext, selectedText),
    [savedContext, selectedText]
  );
  const currentContextFingerprint = useMemo(
    () =>
      contextReviewFingerprint({ selection: effectiveContext, files, activePath, selectedText }),
    [activePath, effectiveContext, files, selectedText]
  );
  const contextReviewed = reviewedContextBySession[activeSessionId] === currentContextFingerprint;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: chatRequestId ? 'auto' : 'smooth' });
  }, [activeSession?.messages, chatRequestId]);

  const sendNow = (request: string, selection: ContextSelection, sensitiveConfirmed: boolean) => {
    setSessionContext(activeSessionId, selection);
    setPrompt('');
    void sendChat(request, selection, sensitiveConfirmed);
  };

  const requestSend = () => {
    if (!prompt.trim() || chatRequestId || !activeSession) return;
    const request = prompt.trim();
    const snapshot = buildContextSnapshot({
      selection: effectiveContext,
      files,
      activePath,
      selectedText,
      recentMessages: activeSession.messages,
      prompt: request,
    });
    if (
      !requiresContextReview(
        reviewedContextBySession[activeSessionId],
        currentContextFingerprint,
        snapshot.warnings
      )
    ) {
      sendNow(request, effectiveContext, true);
      return;
    }
    setContextIntent('send');
    setContextOpen(true);
  };

  const confirmContext = (selection: ContextSelection, sensitiveConfirmed: boolean) => {
    const normalized = normalizeContextSelection(selection, selectedText);
    const fingerprint = contextReviewFingerprint({
      selection: normalized,
      files,
      activePath,
      selectedText,
    });
    setSessionContext(activeSessionId, normalized);
    setReviewedContextBySession((current) => ({
      ...current,
      [activeSessionId]: fingerprint,
    }));
    setContextOpen(false);
    if (contextIntent === 'review') return;
    const request = prompt.trim();
    if (request) sendNow(request, normalized, sensitiveConfirmed);
  };

  const retryMessage = (messageIndex: number) => {
    const previous = activeSession?.messages
      .slice(0, messageIndex)
      .reverse()
      .find((item) => item.role === 'user');
    if (!previous) return;
    setPrompt(previous.content);
    setContextIntent('send');
    setContextOpen(true);
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
            {activeProvider
              ? `${activeProvider.id} · ${activeProvider.model}`
              : t('providerNotConfigured')}
          </span>
        </div>
        <Tooltip title={t('newSession')}>
          <Button type="text" icon={<PlusOutlined />} onClick={() => void createSession()} />
        </Tooltip>
      </header>
      <Select
        value={activeSessionId || undefined}
        onChange={selectSession}
        options={sessions.map((session) => ({ value: session.id, label: session.title }))}
        className={styles.sessionSelect}
        placeholder={t('newSession')}
      />
      {chatError && <Alert className={styles.chatError} type="error" showIcon title={chatError} />}
      <div className={styles.messages} aria-live="polite">
        {activeSession?.messages.map((chatMessage, index) => {
          const containsPatchProtocol =
            chatMessage.role === 'assistant' &&
            chatMessage.content.toLowerCase().includes('document_patch');
          const containsA2uiProtocol =
            chatMessage.role === 'assistant' && /a2ui_(surface|update)/i.test(chatMessage.content);
          const patchFailed = chatMessage.errorCode === 'PATCH_VALIDATION_FAILED';
          const a2uiFailed = chatMessage.errorCode === 'A2UI_VALIDATION_FAILED';
          const patchGenerating = containsPatchProtocol && chatMessage.status === 'streaming';
          const a2uiGenerating = containsA2uiProtocol && chatMessage.status === 'streaming';
          return (
            <article
              key={chatMessage.id}
              className={`${styles.message} ${chatMessage.role === 'user' ? styles.user : styles.assistant}`}
            >
              <div className={styles.role}>{chatMessage.role === 'user' ? 'YOU' : 'A2UI'}</div>
              {a2uiGenerating ? (
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
                      patchFailed
                        ? t('patchValidationFailedDescription')
                        : t('patchProtocolReceivedDescription')
                    }
                  />
                  {!patchFailed && pendingDiff ? (
                    <Button type="link" onClick={() => setCenterView('diff')}>
                      {t('openReviewCenter')}
                    </Button>
                  ) : null}
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
                patchFailed ||
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
              setContextIntent('review');
              setContextOpen(true);
            }}
          >
            {t('context')}
          </Button>
          {activePath && <Tag color="blue">{activePath}</Tag>}
          {(savedContext?.projectFiles ?? []).map((path) => (
            <Tag key={path}>{path}</Tag>
          ))}
          <Tag color={contextReviewed ? 'green' : 'orange'}>
            {t(contextReviewed ? 'contextSaved' : 'contextRequired')}
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
            disabled={!prompt.trim()}
            onClick={requestSend}
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
          onCancel={() => setContextOpen(false)}
          onConfirm={confirmContext}
        />
      )}
    </aside>
  );
}
