import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, message, Select, Tooltip } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import { ContextSelector } from '../../context/components/ContextSelector';
import { useChatContextFlow } from '../useChatContextFlow';
import { ChatComposer } from './ChatComposer';
import { ChatMessageList } from './ChatMessageList';
import styles from './ChatPanel.module.css';

interface ChatPanelProps {
  professionalTools?: boolean;
}

export function ChatPanel({ professionalTools = true }: ChatPanelProps) {
  const { t } = useI18n();
  const chatError = useAppStore((state) => state.chatError);
  const chatRequestId = useAppStore((state) => state.chatRequestId);
  const pendingDiff = useAppStore((state) => state.pendingDiff);
  const setCenterView = useAppStore((state) => state.setCenterView);
  const createSession = useAppStore((state) => state.createSession);
  const selectSession = useAppStore((state) => state.selectSession);
  const stopChat = useAppStore((state) => state.stopChat);
  const addFileToContext = useAppStore((state) => state.addFileToContext);
  const addFile = useAppStore((state) => state.addFile);
  const context = useChatContextFlow();

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
      addFileToContext(context.activeSessionId, path);
    }
  };

  return (
    <aside className={styles.panel} aria-label={t('assistant')}>
      <header className={styles.header}>
        <div>
          <strong>{t('assistant')}</strong>
          <span>
            <i className={context.activeProvider?.configured ? styles.online : styles.offline} />
            {professionalTools
              ? context.activeProvider
                ? `${context.activeProvider.id} · ${context.activeProvider.model}`
                : t('providerNotConfigured')
              : t(context.activeProvider?.configured ? 'assistantReady' : 'assistantSetupNeeded')}
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
          value={context.activeSessionId || undefined}
          onChange={selectSession}
          options={context.sessions.map((session) => ({ value: session.id, label: session.title }))}
          className={styles.sessionSelect}
          placeholder={t('newSession')}
        />
      ) : null}
      {chatError && <Alert className={styles.chatError} type="error" showIcon title={chatError} />}
      <ChatMessageList
        messages={context.activeSession?.messages ?? []}
        requestActive={Boolean(chatRequestId)}
        reviewAvailable={Boolean(pendingDiff)}
        onOpenReview={() => setCenterView('diff')}
        onOpenSurface={() => setCenterView('surface')}
        onRetry={context.retryMessage}
      />
      <ChatComposer
        prompt={context.prompt}
        activePath={context.activePath}
        projectFiles={context.savedContext?.projectFiles ?? []}
        processingLocation={context.processingLocation}
        hasReviewedContext={context.hasReviewedContext}
        contextReviewed={context.contextReviewed}
        requestActive={Boolean(chatRequestId)}
        manifestLoading={context.manifestLoading}
        contextOpen={context.contextOpen}
        onPromptChange={context.updatePrompt}
        onOpenContext={context.openContext}
        onSend={() => context.requestSend()}
        onStop={() => void stopChat()}
        onDropFiles={(files) => void addDroppedFiles(files)}
      />
      {context.contextOpen && (
        <ContextSelector
          open
          prompt={context.prompt}
          initialSelection={context.effectiveContext}
          confirmText={context.contextIntent === 'review' ? t('saveContextSelection') : undefined}
          manifest={context.visibleManifest}
          planning={context.manifestLoading}
          indexClearing={context.indexClearing}
          error={context.visibleManifestError}
          processingLocation={context.processingLocation}
          reviewOnly={context.contextIntent === 'review'}
          onCancel={context.closeContext}
          onPlan={(selection) => void context.planContext(selection)}
          onInvalidateManifest={context.invalidateManifest}
          onClearIndex={
            context.canClearContextIndex ? () => void context.clearContextIndex() : undefined
          }
          onConfirm={context.confirmContext}
        />
      )}
    </aside>
  );
}
