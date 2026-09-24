import { ChatHeader } from '../chat/components/ChatHeader';
import { ChatComposer } from '../chat/components/ChatComposer';
import { AssistantMarkdown } from '../chat/components/ChatMessageList';
import { AssistantProgress } from '../chat/components/AssistantProgress';
import { ContextManifestSummary } from '../context/components/ContextManifestSummary';
import chatStyles from '../chat/components/ChatPanel.module.css';
import { importController } from '../imports/importController';
import { InfoNotice } from '../../shared/components/InfoNotice';
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Tag } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { useAppStore } from '../../stores/useAppStore';
import { errorDetails } from '../../stores/support';
import type { ContextPack, ReviewRequest, DocumentSource } from '../../shared/types/domain';
import type { GenerationPlan } from '../../shared/types/generation';
import { KnowledgePicker } from '../knowledge/KnowledgePicker';
import { contextPackController } from '../contextPacks/contextPackController';
import { generationController as api } from './generationController';
import { isWebMock } from '../../shared/platform/runtime';
import { reviewController } from '../diff/reviewController';
import styles from './GenerationPanel.module.css';
import { TextStreamBuffer } from '../chat/textStreamBuffer';
import {
  approvedSensitiveConfirmation,
  generationSessionKey,
  readGenerationSession,
  rememberGenerationScope,
  writeGenerationSession,
} from './generationSession';

interface Props {
  resultId?: string;
  targetTitle?: string;
  taskId?: string;
  workspaceId: string;
  blocked?: boolean;
  onApplied: (resultId: string) => void;
}

export function GenerationPanel({
  resultId,
  targetTitle,
  taskId,
  workspaceId,
  blocked = false,
  onApplied,
}: Props) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const providers = useAppStore((s) => s.providerConfigs);
  const active = useAppStore((s) => s.activeProviderId);
  const selectedProvider = providers.find((p) => p.id === active);
  const location = useAppStore((s) => s.processingOptions?.processingLocation ?? 'cloud');
  const sessionKey = generationSessionKey(workspaceId, resultId, taskId);
  const [initialSession] = useState(() => readGenerationSession(sessionKey));
  const [prompt, setPrompt] = useState(
    initialSession?.prompt ??
      (taskId
        ? zh
          ? '根据已填写的任务要求生成完整正文'
          : 'Write a complete document using the task requirements'
        : '')
  );
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>(initialSession?.knowledgeIds ?? []);
  const [packIds, setPackIds] = useState<string[]>(initialSession?.packIds ?? []);
  const [packs, setPacks] = useState<ContextPack[]>([]);
  const [includeResult, setIncludeResult] = useState(initialSession?.includeResult ?? false);
  const [contextOpen, setContextOpen] = useState(false);
  const [documentIds, setDocumentIds] = useState<string[]>(initialSession?.documentIds ?? []);
  const [documents, setDocuments] = useState<DocumentSource[]>([]);
  const [sentPlan, setSentPlan] = useState<GenerationPlan | null>(initialSession?.sentPlan ?? null);
  const [stopping, setStopping] = useState(false);
  const [plan, setPlan] = useState<GenerationPlan | null>(null);
  const [sensitive, setSensitive] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'planning' | 'generating' | 'applying'>('idle');
  const [error, setError] = useState('');
  const [text, setText] = useState(initialSession?.text ?? '');
  const [review, setReview] = useState<ReviewRequest | null>(null);
  const [applied, setApplied] = useState<ReviewRequest | null>(initialSession?.applied ?? null);
  const [fileName, setFileName] = useState('generated.md');
  const requestId = useRef<string | null>(null);
  const mounted = useRef(true);
  const stopped = useRef(false);
  const outputPane = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const providerSignature = JSON.stringify(selectedProvider);
  const [plannedProvider, setPlannedProvider] = useState('');
  const busy = phase !== 'idle';
  const planValid = plan && plannedProvider === providerSignature && !blocked;
  useLayoutEffect(() => {
    const pane = outputPane.current;
    if (pane && followOutput.current && text) pane.scrollTop = pane.scrollHeight;
  }, [text]);
  useEffect(() => {
    writeGenerationSession(sessionKey, {
      prompt,
      knowledgeIds,
      documentIds,
      packIds,
      includeResult,
      sentPlan,
      text,
      applied,
    });
  }, [
    applied,
    documentIds,
    includeResult,
    knowledgeIds,
    packIds,
    prompt,
    sentPlan,
    sessionKey,
    text,
  ]);
  useEffect(() => {
    mounted.current = true;
    void importController
      .listSources(workspaceId)
      .then((items) => {
        if (mounted.current) setDocuments(items.filter((s) => s.kind === 'text'));
      })
      .catch((e) => {
        if (mounted.current) setError(errorDetails(e).message);
      });
    void contextPackController
      .list(workspaceId)
      .then(setPacks)
      .catch((e) => {
        if (mounted.current) setError(errorDetails(e).message);
      });
    if (resultId && !isWebMock())
      void reviewController
        .listActive(workspaceId)
        .then((items) => {
          if (mounted.current) setReview(items.find((r) => r.resultId === resultId) ?? null);
        })
        .catch((e) => {
          if (mounted.current) setError(errorDetails(e).message);
        });
    return () => {
      mounted.current = false;
      if (requestId.current) void api.stop(requestId.current).catch(() => {});
    };
  }, [workspaceId, resultId]);
  const invalidate = () => {
    setPlan(null);
    setSensitive(false);
  };
  const run = async (action: () => Promise<void>, next: typeof phase) => {
    setPhase(next);
    setError('');
    try {
      await action();
    } catch (e) {
      if (mounted.current) setError(errorDetails(e).message);
    } finally {
      if (mounted.current) setPhase('idle');
    }
  };
  const executePlan = async (
    selectedPlan: GenerationPlan,
    signature: string,
    sensitiveConfirmed: boolean,
    rememberScope: boolean
  ) => {
    setPhase('generating');
    setError('');
    stopped.current = false;
    followOutput.current = true;
    setStopping(false);
    setSentPlan(selectedPlan);
    requestId.current = selectedPlan.requestId;
    setText('');
    setApplied(null);
    setPlan(null);
    const buffer = new TextStreamBuffer((delta) => {
      if (mounted.current && !stopped.current) setText((current) => current + delta);
    });
    try {
      await api.confirm(selectedPlan.id, sensitiveConfirmed);
      if (mounted.current) setPrompt('');
      if (rememberScope)
        rememberGenerationScope(sessionKey, selectedPlan, signature, sensitiveConfirmed);
      if (stopped.current || !mounted.current) return;
      const output = await api.start(selectedPlan.id, (event) => {
        if (event.type === 'delta') buffer.push(event.delta);
      });
      if (!mounted.current || stopped.current) {
        await api.discard(output.review);
        return;
      }
      setReview(output.review);
      setFileName(output.review.blocks[0]?.suggestedFileName ?? 'generated.md');
    } catch (e) {
      if (mounted.current) setError(errorDetails(e).message);
    } finally {
      await buffer.finish();
      requestId.current = null;
      if (mounted.current) {
        setPlan(null);
        setPhase('idle');
      }
    }
  };
  const planRequest = async () => {
    setPhase('planning');
    setError('');
    let automatic = false;
    try {
      const signature = providerSignature;
      const output = await api.plan({
        resultId: resultId ?? null,
        taskId: taskId ?? null,
        providerId: active,
        prompt,
        includeResult,
        knowledgeIds,
        documentSourceIds: documentIds,
        contextPackIds: packIds,
      });
      if (!mounted.current) return;
      setPlannedProvider(signature);
      setContextOpen(false);
      setSensitive(false);
      const approved = approvedSensitiveConfirmation(sessionKey, output, signature);
      if (approved === null) {
        setPlan(output);
      } else {
        automatic = true;
        await executePlan(output, signature, approved, false);
      }
    } catch (e) {
      if (mounted.current) setError(errorDetails(e).message);
    } finally {
      if (mounted.current && !automatic) setPhase('idle');
    }
  };
  const generate = () => {
    if (!planValid || !plan) return;
    void executePlan(plan, plannedProvider, sensitive, true);
  };
  const apply = () =>
    run(async () => {
      if (!review) return;
      try {
        const output = await api.apply(review, fileName);
        setApplied(review);
        setReview(null);
        setText('');
        if (output.result) onApplied(output.result.result.id);
        else if (resultId) onApplied(resultId);
      } catch (e) {
        if (!isWebMock()) setReview(await reviewController.get(review.id));
        throw e;
      }
    }, 'applying');
  return (
    <section
      className={`${chatStyles.panel} ${taskId ? styles.taskPanel : ''}`}
      aria-label={zh ? 'AI 写作' : 'AI writing'}
    >
      <ChatHeader
        configured={Boolean(selectedProvider?.configured)}
        busy={busy}
        professionalTools={false}
        onProviderChange={invalidate}
        targetLabel={
          (zh ? '目标：' : 'Target: ') +
          (targetTitle ??
            sentPlan?.targetTitle ??
            (taskId
              ? zh
                ? '新建任务成果'
                : 'New task result'
              : zh
                ? '当前成果'
                : 'Current result'))
        }
      />
      <div
        className={chatStyles.messages}
        ref={outputPane}
        onScroll={(event) => {
          const pane = event.currentTarget;
          followOutput.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
        }}
      >
        {!sentPlan && (
          <InfoNotice
            showIcon
            title={
              zh
                ? '生成提案，审阅后写入当前成果'
                : 'Generate a proposal, then review before applying'
            }
            description={
              zh
                ? '通过“上下文”选择本次发送范围。成果正文默认不发送。'
                : 'Choose sources in the sending scope. Document content is opt-in.'
            }
          />
        )}
        {isWebMock() && <Tag>Web Mock</Tag>}
        {blocked && (
          <Alert
            type="warning"
            title={zh ? '请先保存或处理当前成果草稿' : 'Save or resolve the current draft first'}
          />
        )}
        {error && <Alert type="error" showIcon title={error} />}
        {!busy && stopping && (
          <InfoNotice
            title={zh ? '已停止生成，未应用任何修改' : 'Generation stopped; no changes applied'}
          />
        )}
        {!selectedProvider?.configured && (
          <Alert
            type="warning"
            title={
              zh
                ? '请先在设置中配置云端 API Key，或选择本地模型'
                : 'Configure an API key in Settings or choose a local model'
            }
          />
        )}
        {sentPlan && (
          <article className={styles.request}>
            <strong>{zh ? '本次要求' : 'This request'}</strong>
            <p className={styles.prompt}>{sentPlan.prompt}</p>
            <details open>
              <summary>{zh ? '本次发送清单' : 'Sources for this request'}</summary>
              <p>
                {sentPlan.manifest.providerId} ·{' '}
                {sentPlan.manifest.processingLocation === 'local'
                  ? zh
                    ? '本地处理'
                    : 'Local processing'
                  : zh
                    ? '云端处理'
                    : 'Cloud processing'}
              </p>
              <ContextManifestSummary manifest={sentPlan.manifest} compact />
            </details>
          </article>
        )}
        {text && (
          <article aria-label={zh ? '候选正文（尚未写入）' : 'Proposed document (not applied)'}>
            <AssistantMarkdown content={text} streaming={phase === 'generating'} />
          </article>
        )}
        {!sentPlan && !busy && (
          <div className={styles.welcome}>
            <h3>{zh ? '你想怎样完善这份成果？' : 'How would you like to improve this result?'}</h3>
            <p>
              {zh
                ? '描述目标、选择资料，确认后开始生成。'
                : 'Describe your goal, choose sources, and confirm to generate.'}
            </p>
          </div>
        )}
        {applied && resultId && (
          <Button
            onClick={() =>
              void run(async () => {
                const output = await api.undo(applied);
                if (output.result) onApplied(output.result.result.id);
                else onApplied(resultId);
                setApplied(null);
              }, 'applying')
            }
            disabled={busy}
          >
            {zh ? '撤销本次 AI 修改' : 'Undo this AI change'}
          </Button>
        )}
      </div>
      {phase === 'generating' && (
        <AssistantProgress receiving={Boolean(text)} stopping={stopping} />
      )}
      <ChatComposer
        prompt={prompt}
        promptLabel={zh ? '写作要求' : 'Writing instructions'}
        activePath={
          includeResult ? (targetTitle ?? (zh ? '当前成果正文' : 'Current document')) : ''
        }
        projectFiles={[]}
        processingLocation={
          phase === 'generating' ? (sentPlan?.manifest.processingLocation ?? location) : location
        }
        hasReviewedContext={Boolean(sentPlan)}
        contextReviewed={false}
        requestActive={phase === 'generating'}
        manifestLoading={phase === 'planning'}
        contextOpen={contextOpen || Boolean(planValid)}
        sendDisabled={busy || blocked || Boolean(review)}
        readOnlyWhileActive
        maxLength={10000}
        contextStatusLabel={
          phase === 'generating'
            ? zh
              ? '已确认发送范围'
              : 'Confirmed scope'
            : zh
              ? '范围变化时确认'
              : 'Confirm when scope changes'
        }
        contextSummary={
          <Tag>
            {zh ? '已选资料：' : 'Selected: '}
            {knowledgeIds.length + documentIds.length + packIds.length + Number(includeResult)}
          </Tag>
        }
        onPromptChange={(value) => {
          setPrompt(value);
          invalidate();
        }}
        onOpenContext={() => setContextOpen(true)}
        onSend={() => void planRequest()}
        onStop={() => {
          stopped.current = true;
          setStopping(true);
          const id = requestId.current;
          if (id) void api.stop(id).catch((e) => setError(errorDetails(e).message));
        }}
      />
      <Modal
        open={contextOpen}
        title={zh ? '本次发送范围' : 'Sending scope'}
        okText={zh ? '规划发送范围' : 'Plan sources'}
        cancelText={zh ? '关闭' : 'Close'}
        onCancel={() => setContextOpen(false)}
        onOk={() => void planRequest()}
        okButtonProps={{ disabled: busy || blocked || !prompt.trim() || Boolean(review) }}
        confirmLoading={phase === 'planning'}
      >
        <p>
          {zh
            ? '仅使用目标所属工作区的授权资料和你明确选择的个人资料。'
            : 'Only sources authorized in the target workspace and explicitly selected personal sources are used.'}
        </p>
        {error && <Alert type="error" title={error} />}
        <fieldset disabled={busy} className={styles.sources}>
          {resultId && (
            <Checkbox
              checked={includeResult}
              disabled={busy}
              onChange={(e) => {
                setIncludeResult(e.target.checked);
                invalidate();
              }}
            >
              {zh ? '本次发送当前成果的已保存正文' : 'Include the saved document for this request'}
            </Checkbox>
          )}
          {
            <KnowledgePicker
              disabled={busy}
              value={knowledgeIds}
              onChange={(ids) => {
                setKnowledgeIds(ids);
                invalidate();
              }}
            />
          }
          {documents.length > 0 && (
            <Select
              mode="multiple"
              aria-label={zh ? '工作区授权资料' : 'Authorized workspace sources'}
              placeholder={
                zh
                  ? '选择目标工作区已授权资料'
                  : 'Choose authorized sources in the target workspace'
              }
              value={documentIds}
              disabled={busy}
              maxCount={20}
              options={documents.map((d) => ({ value: d.id, label: d.name }))}
              onChange={(ids) => {
                setDocumentIds(ids);
                invalidate();
              }}
            />
          )}
          {packs.length > 0 && (
            <Select
              mode="multiple"
              aria-label={zh ? '写作资料包' : 'Writing packs'}
              placeholder={zh ? '选择目标工作区的资料包' : 'Choose packs from the target workspace'}
              value={packIds}
              maxCount={10}
              disabled={busy}
              options={packs.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(ids) => {
                setPackIds(ids);
                invalidate();
              }}
            />
          )}
        </fieldset>
      </Modal>
      <Modal
        open={Boolean(planValid)}
        title={zh ? '确认 AI 写作发送范围' : 'Confirm writing context'}
        okText={zh ? '确认并生成' : 'Confirm and generate'}
        cancelText={zh ? '取消' : 'Cancel'}
        onCancel={() => {
          if (!busy) setPlan(null);
        }}
        onOk={() => void generate()}
        confirmLoading={phase === 'generating'}
        okButtonProps={{
          disabled: busy || Boolean(plan?.manifest.requiresSensitiveConfirmation && !sensitive),
        }}
        cancelButtonProps={{ disabled: busy }}
        closable={!busy}
        mask={{ closable: !busy }}
      >
        <p>{plan?.targetTitle}</p>
        <p>
          {plan?.manifest.providerId} · {selectedProvider?.model}
        </p>
        <p>{selectedProvider?.endpoint}</p>
        <p>
          {plan?.manifest.processingLocation === 'local'
            ? zh
              ? '本地模型处理'
              : 'Local processing'
            : zh
              ? '将发送给所选云端模型'
              : 'Sends to the selected cloud model'}
        </p>
        <pre className={styles.preview}>{plan?.prompt}</pre>
        {plan?.manifest.includedSources.length === 0 && (
          <p>{zh ? '不发送资料正文，仅发送写作要求' : 'Instructions only; no source content'}</p>
        )}
        {plan && <ContextManifestSummary manifest={plan.manifest} />}
        <p>
          {zh ? '预计 Token：' : 'Estimated tokens: '}
          {plan?.manifest.estimatedTokens}
        </p>
        {plan?.manifest.requiresSensitiveConfirmation && (
          <Checkbox checked={sensitive} onChange={(e) => setSensitive(e.target.checked)}>
            {zh ? '我确认发送清单中的敏感内容' : 'I confirm sending the listed sensitive content'}
          </Checkbox>
        )}
      </Modal>
      <Modal
        open={Boolean(review)}
        title={zh ? '审阅 AI 写作提案' : 'Review writing proposal'}
        footer={null}
        width={850}
        closable={false}
        mask={{ closable: false }}
      >
        {error && <Alert type="error" title={error} />}
        <p>
          {zh
            ? '接受后才写入成果。请核对事实、遗漏和语气。'
            : 'Only acceptance writes the result. Check facts, omissions and tone.'}
        </p>
        {review?.blocks.map((block) => (
          <div key={block.id}>
            <strong>{block.targetLabel}</strong>
            <details>
              <summary>{zh ? '修改前' : 'Before'}</summary>
              <pre className={styles.preview}>{block.before}</pre>
            </details>
            <h4>{zh ? '候选正文' : 'Proposed document'}</h4>
            <pre className={styles.preview}>{block.after}</pre>
          </div>
        ))}
        {review?.operationKind === 'create_file' && (
          <Input
            aria-label={zh ? '成果文件名' : 'Result filename'}
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            maxLength={120}
          />
        )}
        <Space wrap>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (review) await api.discard(review);
                setReview(null);
                setText('');
              }, 'applying')
            }
          >
            {zh ? '拒绝提案' : 'Reject proposal'}
          </Button>
          {review?.status === 'conflicted' ? (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const output = await reviewController.resolveConflict(
                    review.id,
                    review.workspaceId,
                    'save_copy'
                  );
                  setReview(null);
                  if (output.result) onApplied(output.result.result.id);
                }, 'applying')
              }
            >
              {zh ? '另存为副本' : 'Save as copy'}
            </Button>
          ) : (
            <Button
              type="primary"
              loading={phase === 'applying'}
              disabled={busy || blocked || review?.status === 'failed'}
              onClick={() => void apply()}
            >
              {zh ? '接受并写入成果' : 'Accept and apply'}
            </Button>
          )}
        </Space>
      </Modal>
    </section>
  );
}
