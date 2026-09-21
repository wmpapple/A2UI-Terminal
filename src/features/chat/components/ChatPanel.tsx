import { Alert, message } from 'antd';
import { useRef, useState, type RefObject } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import { ContextSelector } from '../../context/components/ContextSelector';
import { useChatContextFlow } from '../useChatContextFlow';
import { ChatHeader } from './ChatHeader';
import { ChatHistoryDrawer } from './ChatHistoryDrawer';
import { ChatComposer } from './ChatComposer';
import { ChatMessageList } from './ChatMessageList';
import styles from './ChatPanel.module.css';

interface ChatPanelProps {
  professionalTools?: boolean;
}

export function ChatPanel(props: ChatPanelProps) {
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceId = useAppStore((state) => state.workspace?.id ?? state.runtimeMode);
  const sessionId = useAppStore((state) => state.activeSessionId);
  return (
    <ChatSessionPanel
      key={JSON.stringify([workspaceId, sessionId])}
      historyButtonRef={historyButtonRef}
      {...props}
    />
  );
}

function ChatSessionPanel({
  professionalTools = true,
  historyButtonRef,
}: ChatPanelProps & { historyButtonRef: RefObject<HTMLButtonElement | null> }) {
  const { t } = useI18n();
  const [historyOpen, setHistoryOpen] = useState(false);
  const chatError = useAppStore((state) => state.chatError);
  const chatRequestId = useAppStore((state) => state.chatRequestId);
  const pendingDiff = useAppStore((state) => state.pendingDiff);
  const setCenterView = useAppStore((state) => state.setCenterView);
  const a2uiSurfaces = useAppStore((state) => state.a2uiSurfaces);
  const a2uiInspections = useAppStore((state) => state.a2uiInspections);
  const setActiveSurface = useAppStore((state) => state.setActiveSurface);
  const setActiveInspection = useAppStore((state) => state.setActiveInspection);
  const createSession = useAppStore((state) => state.createSession);
  const selectSession = useAppStore((state) => state.selectSession);
  const deleteSession = useAppStore((state) => state.deleteSession);
  const pinSession = useAppStore((state) => state.pinSession);
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
      <ChatHeader
        historyButtonRef={historyButtonRef}
        historyOpen={historyOpen}
        onOpenHistory={() => setHistoryOpen((open) => !open)}
        configured={Boolean(context.activeProvider?.configured)}
        busy={Boolean(chatRequestId)}
        professionalTools={professionalTools}
        modelLabel={
          professionalTools && context.activeProvider
            ? `${context.activeProvider.id} · ${context.activeProvider.model}`
            : undefined
        }
        onNewSession={() => void createSession()}
      />
      <ChatHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={context.sessions}
        activeSessionId={context.activeSessionId}
        onDelete={deleteSession}
        error={chatError}
        onPin={pinSession}
        busy={Boolean(chatRequestId)}
        onSelect={(id) => {
          setHistoryOpen(false);
          selectSession(id);
          requestAnimationFrame(() => historyButtonRef.current?.focus());
        }}
      />
      {chatError && <Alert className={styles.chatError} type="error" showIcon title={chatError} />}
      <ChatMessageList
        messages={context.activeSession?.messages ?? []}
        requestActive={Boolean(chatRequestId)}
        reviewAvailable={Boolean(pendingDiff)}
        onOpenReview={() => setCenterView('diff')}
        onOpenSurface={(messageId, failed) => {
          if (failed) {
            const inspection = a2uiInspections.find((item) => item.messageId === messageId);
            if (inspection) {
              setActiveInspection(inspection.id);
              return;
            }
          } else {
            const surface = a2uiSurfaces.find((item) => item.messageId === messageId);
            if (surface) {
              setActiveSurface(surface.surfaceId);
              return;
            }
          }
          setCenterView('surface');
        }}
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
