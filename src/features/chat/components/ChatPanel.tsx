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
import type { WritingProject, WritingSection } from '../../../shared/types/writingProject';
import { ProjectAssistantContext } from './ProjectAssistantContext';
import { openAssistantSurface } from '../openAssistantSurface';
import {
  hasSelectedMaterial,
  assistantTargetLabel,
  projectInlineContext,
  toolInlineContext,
} from '../inlineAssistantContext';

interface ChatPanelProps {
  professionalTools?: boolean;
  toolId?: string | null;
  project?: WritingProject | null;
  projectSection?: WritingSection | null;
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
  project,
  projectSection,
  historyButtonRef,
}: ChatPanelProps & { historyButtonRef: RefObject<HTMLButtonElement | null> }) {
  const { t } = useI18n();
  const [historyOpen, setHistoryOpen] = useState(false);
  const chatError = useAppStore((state) => state.chatError);
  const chatRequestId = useAppStore((state) => state.chatRequestId);
  const pendingDiff = useAppStore((state) => state.pendingDiff);
  const setCenterView = useAppStore((state) => state.setCenterView);
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
  const projectMode = project !== undefined;
  const { link, material } = useToolLinkedMaterial(toolId);
  const inlineContext = projectMode
    ? projectInlineContext(project, projectSection)
    : toolMode
      ? toolInlineContext(toolId, toolTitle, toolEntry)
      : undefined;
  const context = useChatContextFlow(inlineContext);
  const materialSelection = hasSelectedMaterial(context.effectiveContext, material);
  const fileSelection = useAppStore((state) => state.selectedText);
  const selectedText = inlineContext?.content ?? (projectMode ? '' : fileSelection);

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
        targetLabel={assistantTargetLabel(
          project,
          projectSection,
          toolMode,
          toolTitle,
          context.activePath,
          useAppStore.getState().workspace?.name ?? 'Workspace',
          t('assistant')
        )}
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
        projectMode ? (
          <ProjectAssistantContext
            project={project ?? null}
            section={projectSection ?? null}
            selection={context.effectiveContext}
            onOpenContext={context.openContext}
            onTask={context.updatePrompt}
          />
        ) : toolId !== undefined ? (
          <ToolAssistantContext
            toolId={toolId ?? null}
            title={toolTitle}
            hasData={Boolean(toolEntry?.view)}
            linkedTitle={link?.targetTitle ?? null}
            linkedIsDocument={link?.binding.type === 'document'}
            linkedMaterial={material}
            linkedMaterialSelected={materialSelection.linkedSelected}
            hasSelectedMaterial={materialSelection.anySelected}
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
          onOpenSurface={openAssistantSurface}
          onRetry={context.retryMessage}
        />
      )}
      {(!projectMode || project) && (
        <ChatComposer
          placeholder={
            projectMode
              ? project
                ? '描述你希望 AI 如何完善当前项目…'
                : '先设置项目目标，再开始与 AI 协作…'
              : t(toolMode ? 'askToolPlaceholder' : 'askPlaceholder')
          }
          compactContext
          additionalMaterialCount={
            (context.effectiveContext.documentSourceIds?.length ?? 0) +
            (context.effectiveContext.contextPackIds?.length ?? 0) +
            (context.effectiveContext.personalKnowledgeIds?.length ?? 0)
          }
          recentMessagesIncluded={
            context.effectiveContext.recentMessages &&
            Boolean(context.activeSession?.messages.length)
          }
          showSuggestions={false}
          selectionIncluded={context.effectiveContext.selection && Boolean(selectedText.trim())}
          selectionLabel={
            projectMode
              ? (projectSection?.title ?? project?.config.title)
              : toolMode
                ? toolTitle
                : undefined
          }
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
            toolMode || projectMode
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
      )}
      {context.contextOpen && (
        <ContextSelector
          open
          inlineContext={
            inlineContext
              ? { label: inlineContext.title, content: inlineContext.content }
              : undefined
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
