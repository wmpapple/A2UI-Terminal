import { RedoOutlined } from '@ant-design/icons';
import { Alert, Button } from 'antd';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { renderSafeMarkdown } from '../../../shared/markdown/renderSafeMarkdown';
import type { ChatMessage } from '../../../shared/types/domain';
import { AssistantMark } from './AssistantMark';
import styles from './ChatPanel.module.css';

const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const rendered = useMemo(() => renderSafeMarkdown(content), [content]);

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
});

const validationFailureReason = (protocolError?: string | null) =>
  protocolError
    ?.replace(/^AI 修改方案未通过安全校验[：:]\s*/, '')
    .replace(/^invalid input:\s*/i, '')
    .trim();

const looksLikeUnverifiedFileCompletionClaim = (content: string) => {
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
};

interface ChatMessageListProps {
  messages: ChatMessage[];
  requestActive: boolean;
  reviewAvailable: boolean;
  onOpenReview: () => void;
  onOpenSurface: (messageId: string, failed: boolean) => void;
  onRetry: (messageIndex: number) => void;
}

export function ChatMessageList({
  messages,
  requestActive,
  reviewAvailable,
  onOpenReview,
  onOpenSurface,
  onRetry,
}: ChatMessageListProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [paused, setPaused] = useState(false);
  const [historyEnd, setHistoryEnd] = useState<number | null>(null);
  const end = Math.min(historyEnd ?? messages.length, messages.length);
  const start = Math.max(0, end - 60);
  const latest = historyEnd === null;

  const showLatest = () => {
    following.current = true;
    setPaused(false);
    setHistoryEnd(null);
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  };

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && following.current && latest) element.scrollTop = element.scrollHeight;
  }, [messages, latest]);

  return (
    <div className={styles.messageRegion}>
      <div
        ref={scrollRef}
        className={styles.messages}
        role="log"
        aria-busy={requestActive}
        aria-label={t('chatHistory')}
        aria-live={paused || !latest ? 'off' : 'polite'}
        onScroll={(event) => {
          const element = event.currentTarget;
          const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
          // A paused window may still contain the newest message. Reaching its
          // bottom must resume following instead of keeping the paused flag stuck.
          following.current = end === messages.length && nearBottom;
          setPaused(!following.current);
          if (following.current) setHistoryEnd(null);
          else if (latest) setHistoryEnd(messages.length);
        }}
      >
        {messages.length === 0 && (
          <div className={styles.welcome}>
            <AssistantMark />
            <h2>{t('chatWelcomeTitle')}</h2>
            <p>{t('chatWelcomeDescription')}</p>
          </div>
        )}
        {start > 0 && (
          <Button
            block
            onClick={() => {
              following.current = false;
              setPaused(true);
              setHistoryEnd(start);
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
          >
            {t('olderMessages')}
          </Button>
        )}
        {messages.slice(start, end).map((chatMessage, offset) => {
          const index = start + offset;
          const containsReviewProtocol =
            chatMessage.role === 'assistant' &&
            /["']type["']\s*:\s*["'](?:document_patch|create_file|replace_empty_file)["']/i.test(
              chatMessage.content
            );
          const containsA2uiProtocol =
            chatMessage.role === 'assistant' &&
            /a2ui_(surface|update)|application\/a2ui\+json|["'](?:createSurface|updateComponents|updateDataModel|deleteSurface)["']/i.test(
              chatMessage.content
            );
          const reviewReady = [
            'PATCH_READY',
            'CREATE_REVIEW_READY',
            'REPLACE_REVIEW_READY',
          ].includes(chatMessage.errorCode ?? '');
          const createReviewReady = chatMessage.errorCode === 'CREATE_REVIEW_READY';
          const replaceReviewReady = chatMessage.errorCode === 'REPLACE_REVIEW_READY';
          const patchFailed = chatMessage.errorCode === 'PATCH_VALIDATION_FAILED';
          const reviewStorageFailed =
            chatMessage.errorCode === 'DATABASE_ERROR' ||
            (patchFailed && chatMessage.protocolError?.includes('local database operation failed'));
          const patchFailureReason = validationFailureReason(chatMessage.protocolError);
          const emptyFileReviewRequired = patchFailureReason?.startsWith('目标文件为空');
          const a2uiFailed = chatMessage.errorCode === 'A2UI_VALIDATION_FAILED';
          const a2uiReady = chatMessage.errorCode === 'A2UI_READY';
          const a2uiResponse = containsA2uiProtocol || a2uiReady || a2uiFailed;
          const unverifiedCompletionClaim =
            chatMessage.errorCode === 'UNVERIFIED_FILE_COMPLETION_CLAIM' ||
            (chatMessage.role === 'assistant' &&
              chatMessage.status === 'complete' &&
              !containsReviewProtocol &&
              !containsA2uiProtocol &&
              looksLikeUnverifiedFileCompletionClaim(chatMessage.content));
          const fileCreationUnavailable = chatMessage.errorCode === 'FILE_CREATION_NOT_AVAILABLE';
          const streamingProtocolEnvelope =
            chatMessage.role === 'assistant' &&
            chatMessage.status === 'streaming' &&
            /^\s*(?:```(?:json)?\s*)?\{/i.test(chatMessage.content);
          const reviewGenerating =
            !containsA2uiProtocol &&
            chatMessage.status === 'streaming' &&
            (containsReviewProtocol || streamingProtocolEnvelope);
          const a2uiGenerating = containsA2uiProtocol && chatMessage.status === 'streaming';
          return (
            <article
              key={chatMessage.id}
              className={`${styles.message} ${chatMessage.role === 'user' ? styles.user : styles.assistant}`}
            >
              <div className={styles.role}>
                {chatMessage.role === 'assistant' && <AssistantMark />}
                {chatMessage.role === 'user' ? 'YOU' : 'A2UI'}
              </div>
              {reviewStorageFailed ? (
                <div className={styles.protocolError}>
                  <Alert
                    type="error"
                    showIcon
                    title={t('reviewStorageFailed')}
                    description={t('reviewStorageFailedDescription')}
                  />
                </div>
              ) : fileCreationUnavailable ? (
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
              ) : a2uiResponse ? (
                <div className={styles.protocolError}>
                  <Alert
                    type={a2uiFailed ? 'warning' : 'success'}
                    showIcon
                    title={t(a2uiFailed ? 'a2uiValidationFailed' : 'a2uiReady')}
                    description={
                      a2uiFailed ? t('a2uiValidationFailedDescription') : t('a2uiReadyDescription')
                    }
                  />
                  <Button type="link" onClick={() => onOpenSurface(chatMessage.id, a2uiFailed)}>
                    {t(a2uiFailed ? 'openInspector' : 'openSurface')}
                  </Button>
                </div>
              ) : reviewGenerating ? (
                <div className={styles.protocolError}>
                  <Alert
                    type="info"
                    showIcon
                    title={t('reviewProposalGenerating')}
                    description={t('reviewProposalGeneratingDescription')}
                  />
                </div>
              ) : containsReviewProtocol || reviewReady ? (
                <div className={styles.protocolError}>
                  <Alert
                    type={patchFailed ? 'warning' : 'success'}
                    showIcon
                    title={t(patchFailed ? 'patchValidationFailed' : 'reviewProposalReady')}
                    description={
                      patchFailed ? (
                        <div>
                          <div>
                            {t(
                              emptyFileReviewRequired
                                ? 'emptyFileReviewRequiredDescription'
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
                      ) : createReviewReady ? (
                        t('createReviewReadyDescription')
                      ) : replaceReviewReady ? (
                        t('replaceReviewReadyDescription')
                      ) : (
                        t('patchProtocolReceivedDescription')
                      )
                    }
                  />
                  {!patchFailed && reviewAvailable ? (
                    <Button type="link" onClick={onOpenReview}>
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
                patchFailed ||
                a2uiFailed) && (
                <Button
                  size="small"
                  type="link"
                  icon={<RedoOutlined />}
                  onClick={() => onRetry(index)}
                >
                  {t('retry')}
                </Button>
              )}
            </article>
          );
        })}
        {end < messages.length && (
          <Button
            block
            onClick={() => {
              const next = Math.min(messages.length, end + 60);
              if (next === messages.length) showLatest();
              else {
                setHistoryEnd(next);
                if (scrollRef.current) scrollRef.current.scrollTop = 0;
              }
            }}
          >
            {t('newerMessages')}
          </Button>
        )}
      </div>
      {(paused || !latest) && (
        <Button className={styles.latestButton} onClick={showLatest}>
          {t('backToLatest')}
        </Button>
      )}
    </div>
  );
}
