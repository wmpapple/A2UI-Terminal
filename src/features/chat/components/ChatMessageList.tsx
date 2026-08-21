import { RedoOutlined } from '@ant-design/icons';
import { Alert, Button } from 'antd';
import MarkdownIt from 'markdown-it';
import { useEffect, useMemo, useRef } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ChatMessage } from '../../../shared/types/domain';
import styles from './ChatPanel.module.css';

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
  onOpenSurface: () => void;
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
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: requestActive ? 'auto' : 'smooth' });
  }, [messages, requestActive]);

  return (
    <div className={styles.messages} aria-live="polite">
      {messages.map((chatMessage, index) => {
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
                <Button type="link" onClick={onOpenSurface}>
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
              (patchFailed && !emptyFilePatchUnsupported) ||
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
      <div ref={endRef} />
    </div>
  );
}
