import { Alert } from 'antd';
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
import { AssistantProgress } from './AssistantProgress';
import { DocumentAssistantContext } from './DocumentAssistantContext';
import { ToolAssistantContext } from './ToolAssistantContext';
import { addDroppedContextFiles } from '../addDroppedContextFiles';
import { useToolLinkedMaterial } from '../useToolLinkedMaterial';
import { useSceneToolStore } from '../../sceneTools/sceneToolStore';

interface ChatPanelProps {
  professionalTools?: boolean;
  toolId?: string | null;
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
  toolId,
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
  const toolEntry = useSceneToolStore((state) => (toolId ? state.entries[toolId] : undefined));
  const toolTitle = toolEntry?.view?.result.title ?? toolId ?? '';
  const toolMode = toolId !== undefined;
  const { link, material } = useToolLinkedMaterial(toolId);
  const inlineContext = toolMode
    ? {
        id: toolId ?? 'no-tool',
        title: toolTitle,
        content: toolEntry?.view
          ? JSON.stringify({ tool: toolTitle, fields: toolEntry.data }, null, 2)
          : '',
      }
    : undefined;
  const context = useChatContextFlow(inlineContext);
  const linkedMaterialSelected =
    material?.kind === 'projectFile'
      ? context.effectiveContext.projectFiles.includes(material.id)
      : material?.kind === 'documentSource'
        ? (context.effectiveContext.documentSourceIds ?? []).includes(material.id)
        : false;
  const hasSelectedMaterial =
    linkedMaterialSelected ||
    context.effectiveContext.projectFiles.length > 0 ||
    (context.effectiveContext.documentSourceIds?.length ?? 0) > 0 ||
    (context.effectiveContext.personalKnowledgeIds?.length ?? 0) > 0 ||
    (context.effectiveContext.contextPackIds?.length ?? 0) > 0;
  const fileSelection = useAppStore((state) => state.selectedText);
  const selectedText = inlineContext?.content ?? fileSelection;

  return (
    <aside className={styles.panel} aria-label={t('assistant')}>
      <ChatHeader
        historyButtonRef={historyButtonRef}
        historyOpen={historyOpen}
        onOpenHistory={() => setHistoryOpen((open) => !open)}
        configured={Boolean(context.activeProvider?.configured)}
        busy={Boolean(chatRequestId)}
        professionalTools={professionalTools}
        onNewSession={() => void createSession()}
        targetLabel={
          toolMode
            ? toolTitle || 'My Tools'
            : context.activePath || (useAppStore.getState().workspace?.name ?? 'Workspace')
        }
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
      {chatRequestId && (
        <AssistantProgress
          receiving={Boolean(
            context.activeSession?.messages.at(-1)?.role === 'assistant' &&
            context.activeSession.messages.at(-1)?.content
          )}
        />
      )}
      {!context.activeSession?.messages.length && !chatRequestId ? (
        toolId !== undefined ? (
          <ToolAssistantContext
            toolId={toolId ?? null}
            title={toolTitle}
            hasData={Boolean(toolEntry?.view)}
            linkedTitle={link?.targetTitle ?? null}
            linkedIsDocument={link?.binding.type === 'document'}
            linkedMaterial={material}
            linkedMaterialSelected={linkedMaterialSelected}
            hasSelectedMaterial={hasSelectedMaterial}
            selection={context.effectiveContext}
            onOpenContext={context.openContext}
            onToggleLinkedMaterial={() => {
              if (material) context.toggleLinkedMaterial(material);
            }}
            onTask={context.updatePrompt}
          />
        ) : (
          <DocumentAssistantContext
            activePath={context.activePath}
            selectedText={selectedText}
            selection={context.effectiveContext}
            onOpenContext={context.openContext}
            onTask={context.updatePrompt}
          />
        )
      ) : (
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
      )}
      <ChatComposer
        placeholder={t(toolMode ? 'askToolPlaceholder' : 'askPlaceholder')}
        compactContext
        additionalMaterialCount={
          (context.effectiveContext.documentSourceIds?.length ?? 0) +
          (context.effectiveContext.contextPackIds?.length ?? 0) +
          (context.effectiveContext.personalKnowledgeIds?.length ?? 0)
        }
        recentMessagesIncluded={
          context.effectiveContext.recentMessages && Boolean(context.activeSession?.messages.length)
        }
        showSuggestions={false}
        selectionIncluded={context.effectiveContext.selection && Boolean(selectedText.trim())}
        selectionLabel={toolMode ? toolTitle : undefined}
        prompt={context.prompt}
        activePath={context.effectiveContext.currentFile ? context.activePath : ''}
        projectFiles={context.effectiveContext.projectFiles}
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
        onDropFiles={
          toolMode
            ? undefined
            : (files) =>
                void addDroppedContextFiles(
                  files,
                  context.activeSessionId,
                  addFile,
                  addFileToContext,
                  t('unsupportedFile')
                )
        }
      />
      {context.contextOpen && (
        <ContextSelector
          open
          inlineContext={
            inlineContext ? { label: toolTitle, content: inlineContext.content } : undefined
          }
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
