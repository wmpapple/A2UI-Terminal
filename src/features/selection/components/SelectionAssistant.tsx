import { Button, Checkbox, Input, message, Modal, Space, Tag } from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ContextManifest } from '../../../shared/types/domain';
import { errorDetails } from '../../../stores/support';
import { useAppStore } from '../../../stores/useAppStore';
import { chatController } from '../../chat/chatController';
import {
  buildContextManifestInput,
  createWebMockManifest,
  processingLocationForProvider,
} from '../../context/contextManifest';
import { useImportStore } from '../../imports/importStore';
import {
  isExplanationAction,
  type SelectionAction,
  selectionActionPrompt,
} from '../selectionActions';
import styles from './SelectionAssistant.module.css';

interface PendingAction {
  action: SelectionAction;
  prompt: string;
  manifest: ContextManifest;
}

export function SelectionAssistant() {
  const { t } = useI18n();
  const runtimeMode = useAppStore((state) => state.runtimeMode);
  const workspace = useAppStore((state) => state.workspace);
  const files = useAppStore((state) => state.files);
  const activePath = useAppStore((state) => state.activePath);
  const selectedText = useAppStore((state) => state.selectedText);
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activeProviderId = useAppStore((state) => state.activeProviderId);
  const providers = useAppStore((state) => state.providerConfigs);
  const chatRequestId = useAppStore((state) => state.chatRequestId);
  const sendChat = useAppStore((state) => state.sendChat);
  const documentSources = useImportStore((state) => state.sources);
  const [customInstruction, setCustomInstruction] = useState('');
  const [planning, setPlanning] = useState(false);
  const [sending, setSending] = useState(false);
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const activeProvider = providers.find((provider) => provider.id === activeProviderId);
  const activeFile = files.find((file) => file.path === activePath);
  const processingLocation = processingLocationForProvider(activeProvider);
  const available = Boolean(
    selectedText.trim() &&
    activeFile &&
    activeFile.editable !== false &&
    (runtimeMode === 'web-mock' || workspace) &&
    sessions.some((session) => session.id === activeSessionId)
  );
  const actions = useMemo(
    () =>
      [
        ['polish', 'selectionPolish'],
        ['shorten', 'selectionShorten'],
        ['professional', 'selectionProfessional'],
        ['explain', 'selectionExplain'],
        ['extract', 'selectionExtract'],
      ] as const,
    []
  );

  if (!available) return null;

  const prepare = async (action: SelectionAction) => {
    if (planning || chatRequestId) return;
    const instruction = action === 'custom' ? customInstruction.trim() : '';
    if (action === 'custom' && !instruction) {
      message.info(t('selectionCustomRequired'));
      return;
    }
    const prompt = selectionActionPrompt(action, instruction);
    const workspaceId = workspace?.id ?? 'web-mock-workspace';
    const sessionId = activeSessionId;
    const input = buildContextManifestInput({
      workspaceId,
      sessionId,
      providerId: activeProviderId,
      prompt,
      selection: {
        selection: true,
        currentFile: false,
        recentMessages: false,
        recentMessageCount: 0,
        projectFiles: [],
      },
      files,
      documentSources: documentSources.filter((source) => source.workspaceId === workspaceId),
      activePath,
      selectedText,
    });
    setPlanning(true);
    try {
      const manifest =
        runtimeMode === 'web-mock'
          ? createWebMockManifest(input, processingLocation)
          : await chatController.planContext(input);
      setSensitiveConfirmed(false);
      setPending({ action, prompt, manifest });
    } catch (error) {
      message.error(errorDetails(error).message);
    } finally {
      setPlanning(false);
    }
  };

  const confirm = async () => {
    if (!pending || sending) return;
    if (pending.manifest.requiresSensitiveConfirmation && !sensitiveConfirmed) return;
    setSending(true);
    try {
      if (runtimeMode === 'desktop') {
        await chatController.confirmContext(
          pending.manifest.id,
          pending.manifest.requiresSensitiveConfirmation && sensitiveConfirmed
        );
      }
      await sendChat(
        pending.prompt,
        pending.manifest.id,
        'selection',
        isExplanationAction(pending.action)
      );
      setPending(null);
      setCustomInstruction('');
    } catch (error) {
      message.error(errorDetails(error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className={styles.assistant} aria-label={t('selectionAssistant')}>
      <Space size={4} wrap>
        <Tag color="blue">
          {t('selectionCount').replace('{count}', String(selectedText.length))}
        </Tag>
        {actions.map(([action, label]) => (
          <Button
            key={action}
            size="small"
            disabled={planning || Boolean(chatRequestId)}
            onClick={() => void prepare(action)}
          >
            {t(label)}
          </Button>
        ))}
        <Input
          size="small"
          className={styles.customInput}
          value={customInstruction}
          maxLength={240}
          aria-label={t('selectionCustom')}
          placeholder={t('selectionCustomPlaceholder')}
          onChange={(event) => setCustomInstruction(event.target.value)}
          onPressEnter={() => void prepare('custom')}
        />
        <Button size="small" loading={planning} onClick={() => void prepare('custom')}>
          {t('selectionCustom')}
        </Button>
      </Space>
      <Modal
        open={Boolean(pending)}
        title={t('selectionConfirmTitle')}
        okText={
          isExplanationAction(pending?.action ?? 'polish')
            ? t('selectionGetExplanation')
            : t('selectionCreateReview')
        }
        cancelText={t('cancel')}
        confirmLoading={sending}
        okButtonProps={{
          disabled: Boolean(pending?.manifest.requiresSensitiveConfirmation && !sensitiveConfirmed),
        }}
        onCancel={() => setPending(null)}
        onOk={() => void confirm()}
      >
        <p>
          {t(
            isExplanationAction(pending?.action ?? 'polish')
              ? 'selectionExplainNotice'
              : 'selectionReviewNotice'
          )}
        </p>
        <Space wrap>
          <Tag>{activePath}</Tag>
          <Tag>{t(processingLocation === 'local' ? 'localProcessing' : 'cloudProcessing')}</Tag>
          <Tag>{t('selectionCount').replace('{count}', String(selectedText.length))}</Tag>
        </Space>
        {pending?.manifest.requiresSensitiveConfirmation ? (
          <Checkbox
            checked={sensitiveConfirmed}
            onChange={(event) => setSensitiveConfirmed(event.target.checked)}
          >
            {t('sensitiveConfirm')}
          </Checkbox>
        ) : null}
      </Modal>
    </section>
  );
}
