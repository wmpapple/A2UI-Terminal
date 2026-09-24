import { Button, Checkbox, Input, message, Modal, Space, Tag } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type {
  DocumentSnapshot,
  InlineEditAction,
  SelectionSnapshot,
} from '../../../shared/types/document';
import type {
  InlineEditPlan,
  ReviewApplication,
  ReviewRequest,
} from '../../../shared/types/domain';
import { errorDetails } from '../../../stores/support';
import { useAppStore } from '../../../stores/useAppStore';
import { createEditorAdapter, type SourceEditorPort } from '../editorAdapter';
import { inlineEditController } from '../inlineEditController';
import styles from './SelectionAssistant.module.css';

interface Props {
  editorPort: SourceEditorPort | null;
  snapshot: DocumentSnapshot | null;
  selectedText: string;
  targetLabel?: string;
  onApplied: (application: ReviewApplication) => void | Promise<void>;
}

interface Proposal {
  review: ReviewRequest;
  selection: SelectionSnapshot;
  replacement: string;
  action: InlineEditAction;
  customInstruction: string;
  providerId: string;
}

interface PendingSensitive {
  plan: InlineEditPlan;
  selection: SelectionSnapshot;
  action: InlineEditAction;
  customInstruction: string;
}

const actions: Array<[InlineEditAction, string]> = [
  ['polish', '润色'],
  ['shorten', '缩短'],
  ['expand', '扩写'],
  ['professional', '专业'],
  ['natural', '自然'],
  ['grammar', '语法'],
  ['translate', '翻译'],
];

const sameSelection = (a: SelectionSnapshot, b: SelectionSnapshot) =>
  JSON.stringify(a) === JSON.stringify(b);

export function SelectionAssistant({
  editorPort,
  snapshot,
  selectedText,
  targetLabel,
  onApplied,
}: Props) {
  const { t } = useI18n();
  const runtimeMode = useAppStore((state) => state.runtimeMode);
  const activeProviderId = useAppStore((state) => state.activeProviderId);
  const [customInstruction, setCustomInstruction] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pendingSensitive, setPendingSensitive] = useState<PendingSensitive | null>(null);
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const epoch = useRef(0);
  const targetKey = JSON.stringify(snapshot?.target ?? null);

  const adapter = useMemo(
    () =>
      editorPort
        ? createEditorAdapter({
            snapshot: () => snapshot,
            source: editorPort,
            showProposal: () => undefined,
            receiveAuthoritativeSnapshot: () => undefined,
          })
        : null,
    [editorPort, snapshot]
  );

  useEffect(() => {
    epoch.current += 1;
    return () => {
      epoch.current += 1;
    };
  }, [snapshot?.contentHash, targetKey, activeProviderId]);

  const currentProposal =
    proposal &&
    proposal.providerId === activeProviderId &&
    proposal.selection.contentHash === snapshot?.contentHash &&
    JSON.stringify(proposal.selection.target) === targetKey
      ? proposal
      : null;
  const currentPending =
    pendingSensitive &&
    pendingSensitive.plan.manifest.providerId === activeProviderId &&
    pendingSensitive.selection.contentHash === snapshot?.contentHash &&
    JSON.stringify(pendingSensitive.selection.target) === targetKey
      ? pendingSensitive
      : null;

  if (!editorPort || !snapshot || !selectedText.trim()) return null;

  const start = async (
    plan: InlineEditPlan,
    selection: SelectionSnapshot,
    action: InlineEditAction,
    instruction: string
  ) => {
    const operation = ++epoch.current;
    setWorking(true);
    try {
      const result = await inlineEditController.start(plan.id, () => undefined);
      if (operation !== epoch.current || !sameSelection(selection, result.selection)) {
        await inlineEditController.discard(result.review);
        return;
      }
      const current = await adapter?.readSelection();
      if (!current || !sameSelection(current, selection)) {
        await inlineEditController.discard(result.review);
        message.warning('选区或文档已变化，请重新选择后再试。');
        return;
      }
      setProposal({
        ...result,
        action,
        customInstruction: instruction,
        providerId: activeProviderId,
      });
      setPendingSensitive(null);
    } catch (error) {
      if (operation === epoch.current) message.error(errorDetails(error).message);
    } finally {
      if (operation === epoch.current) setWorking(false);
    }
  };

  const generate = async (
    action: InlineEditAction,
    instruction = customInstruction.trim(),
    replacingProposal = false
  ) => {
    if (working || (!replacingProposal && currentProposal) || !adapter) return;
    if (action === 'custom' && !instruction) {
      message.info('请先填写修改要求。');
      return;
    }
    const selection = await adapter.readSelection();
    if (!selection) {
      message.warning('请先保存文档并重新选择一段连续文字。');
      return;
    }
    setWorking(true);
    try {
      const plan = await inlineEditController.plan({
        selection,
        providerId: activeProviderId,
        action,
        customInstruction: action === 'custom' ? instruction : null,
        selectedText: selectedText,
        documentText: snapshot.text,
        targetLabel,
      });
      if (plan.manifest.requiresSensitiveConfirmation) {
        setPendingSensitive({ plan, selection, action, customInstruction: instruction });
        setSensitiveConfirmed(false);
        return;
      }
      await inlineEditController.confirm(plan.id, false);
      setWorking(false);
      await start(plan, selection, action, instruction);
      if (action === 'custom') setCustomInstruction('');
    } catch (error) {
      message.error(errorDetails(error).message);
    } finally {
      setWorking(false);
    }
  };

  const accept = async () => {
    if (!currentProposal || working || !adapter) return;
    const current = await adapter.readSelection();
    if (!current || !sameSelection(current, currentProposal.selection)) {
      message.warning('选区或文档已变化，这条建议已失效。');
      setProposal(null);
      return;
    }
    setWorking(true);
    try {
      const application = await inlineEditController.accept(currentProposal.review);
      await onApplied(application);
      setProposal(null);
    } catch (error) {
      message.error(errorDetails(error).message);
    } finally {
      setWorking(false);
    }
  };

  const dismiss = async () => {
    const current = currentProposal;
    epoch.current += 1;
    setProposal(null);
    if (current && runtimeMode === 'desktop') {
      try {
        await inlineEditController.discard(current.review);
      } catch {
        // A stale review is harmless; no write occurred.
      }
    }
  };

  const regenerate = async () => {
    if (!currentProposal) return;
    const { action, customInstruction: instruction } = currentProposal;
    await dismiss();
    await generate(action, instruction, true);
  };

  return (
    <section className={styles.assistant} aria-label={t('selectionAssistant')}>
      <div className={styles.actions}>
        <Tag className={styles.selectionBadge}>{selectedText.length} 个字符</Tag>
        {actions.map(([action, label]) => (
          <Button
            key={action}
            type="text"
            className={styles.chip}
            size="small"
            disabled={working || Boolean(currentProposal)}
            onClick={() => void generate(action, '')}
          >
            {label}
          </Button>
        ))}
        <div className={styles.customControl}>
          <Input
            size="small"
            variant="borderless"
            className={styles.customInput}
            value={customInstruction}
            maxLength={500}
            aria-label="自定义选区修改"
            placeholder="例如：改成更适合客户阅读的表达"
            onChange={(event) => setCustomInstruction(event.target.value)}
            disabled={working || Boolean(currentProposal)}
            onPressEnter={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              void generate('custom');
            }}
          />
          <Button
            type="text"
            size="small"
            disabled={!customInstruction.trim() || working || Boolean(currentProposal)}
            loading={working}
            onClick={() => void generate('custom')}
          >
            修改
          </Button>
        </div>
      </div>

      {currentProposal ? (
        <article className={styles.proposal} aria-label="AI 行内修改建议">
          <div className={styles.proposalGrid}>
            <div>
              <strong>原文</strong>
              <pre>{currentProposal.review.blocks[0]?.before}</pre>
            </div>
            <div>
              <strong>AI 建议</strong>
              <pre>{currentProposal.replacement}</pre>
            </div>
          </div>
          <Space wrap>
            <Button type="primary" loading={working} onClick={() => void accept()}>
              接受
            </Button>
            <Button disabled={working} onClick={() => void regenerate()}>
              重新生成
            </Button>
            <Button disabled={working} onClick={() => void dismiss()}>
              关闭
            </Button>
            <Tag color="green">低风险 · 仅当前选区</Tag>
          </Space>
        </article>
      ) : null}

      <Modal
        open={Boolean(currentPending)}
        title="确认发送敏感内容"
        okText="确认并生成"
        cancelText="取消"
        confirmLoading={working}
        okButtonProps={{ disabled: !sensitiveConfirmed }}
        onCancel={() => {
          epoch.current += 1;
          setPendingSensitive(null);
        }}
        onOk={async () => {
          if (!currentPending || !sensitiveConfirmed) return;
          setWorking(true);
          try {
            await inlineEditController.confirm(currentPending.plan.id, true);
            setWorking(false);
            await start(
              currentPending.plan,
              currentPending.selection,
              currentPending.action,
              currentPending.customInstruction
            );
          } catch (error) {
            message.error(errorDetails(error).message);
            setWorking(false);
          }
        }}
      >
        <p>所选文字将发送到当前云端模型。只有当前选区会被发送。</p>
        <Checkbox
          checked={sensitiveConfirmed}
          onChange={(event) => setSensitiveConfirmed(event.target.checked)}
        >
          我确认发送当前选区
        </Checkbox>
      </Modal>
    </section>
  );
}
