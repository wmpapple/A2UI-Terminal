import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Empty,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { useAppStore } from '../../stores/useAppStore';
import { errorDetails } from '../../stores/support';
import { userFacingError } from '../../shared/errors/userFacingError';
import type { DocumentSnapshot } from '../../shared/types/document';
import type {
  CriticFinding,
  CriticReport,
  CriticView,
  CriticPlan,
} from '../../shared/types/critic';
import type { InlineEditPlan, ReviewApplication } from '../../shared/types/domain';
import { ContextManifestSummary } from '../context/components/ContextManifestSummary';
import { inlineEditController } from '../selection/inlineEditController';
import { criticController as api } from './criticController';

type Proposal = Awaited<ReturnType<typeof inlineEditController.start>>;
export function CriticPanel({
  snapshot,
  workspaceId,
  onApplied,
}: {
  snapshot: DocumentSnapshot | null;
  workspaceId: string;
  onApplied: (application: ReviewApplication) => void | Promise<void>;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const say = (cn: string, en: string) => (zh ? cn : en);
  const providers = useAppStore((s) => s.providerConfigs);
  const activeProvider = useAppStore((s) => s.activeProviderId);
  const [open, setOpen] = useState(false),
    [view, setView] = useState<CriticView | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [generating, setGenerating] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [options, setOptions] = useState({ sentenceLimit: 120, paragraphLimit: 400 });
  const [provider, setProvider] = useState(activeProvider),
    [showIgnored, setShowIgnored] = useState(false);
  const [selected, setSelected] = useState<{ report: CriticReport; finding: CriticFinding } | null>(
    null
  );
  const [plan, setPlan] = useState<{
      kind: 'critic' | 'fix';
      value: CriticPlan | InlineEditPlan;
      epoch: number;
      bindingKey: string;
    } | null>(null),
    [sensitive, setSensitive] = useState(false),
    [proposal, setProposal] = useState<Proposal | null>(null);
  const epoch = useRef({ value: 0 });
  const running = useRef<{ kind: 'critic' | 'fix'; id: string } | null>(null);
  const pending = useRef<typeof plan>(null);
  const current = useRef(snapshot);
  useEffect(() => {
    current.current = snapshot;
  }, [snapshot]);
  const key = JSON.stringify([
    snapshot?.target,
    snapshot?.contentHash,
    snapshot?.revisionId,
    snapshot?.hasUnsavedDraft,
  ]);
  const dirty = !snapshot || snapshot.hasUnsavedDraft;
  const matches = (r: CriticReport) =>
    !dirty &&
    r.binding.contentHash === snapshot?.contentHash &&
    r.binding.revisionId === snapshot?.revisionId &&
    JSON.stringify(r.binding.target) === JSON.stringify(snapshot?.target);
  useEffect(() => {
    const ticket = epoch.current;
    ticket.value++;
    let disposed = false;
    if (open && snapshot && !snapshot.hasUnsavedDraft) {
      void api
        .inspect(snapshot, options, workspaceId)
        .then((v) => {
          if (!disposed) {
            setView(v);
            setError('');
          }
        })
        .catch((e) => {
          if (!disposed) {
            setView(null);
            setError(errorDetails(e).message);
          }
        });
    }
    return () => {
      disposed = true;
      ticket.value++;
    };
    // Snapshot content is identified by its hash/revision; do not re-run on parent renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, options, refresh, workspaceId]);
  useEffect(
    () => () => {
      if (running.current?.kind === 'critic') void api.cancel(running.current.id);
      if (running.current?.kind === 'fix') void inlineEditController.stop(running.current.id);
      if (pending.current?.kind === 'critic') void api.cancel(pending.current.value.id);
    },
    []
  );
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorDetails(e).message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    epoch.current.value++;
    if (running.current?.kind === 'critic') void api.cancel(running.current.id);
    if (running.current?.kind === 'fix') void inlineEditController.stop(running.current.id);
    if (pending.current?.kind === 'critic') void api.cancel(pending.current.value.id);
    if (proposal) void inlineEditController.discard(proposal.review);
    setProposal(null);
    setPlan(null);
    pending.current = null;
    setOpen(false);
  };
  const prepareFix = async (r: CriticReport, f: CriticFinding) => {
    if (!snapshot || !matches(r)) throw Error('正文已变化，请重新检查');
    const ticket = epoch.current.value;
    const resolved = await api.resolve(r.id, f.id);
    const next = await inlineEditController.plan({
      selection: resolved.selection,
      providerId: provider,
      action: 'custom',
      customInstruction: resolved.instruction,
      selectedText: f.quote,
      documentText: snapshot.text,
    });
    if (ticket !== epoch.current.value) return;
    pending.current = { kind: 'fix', value: next, epoch: ticket, bindingKey: key };
    setPlan(pending.current);
    setSensitive(false);
  };
  const send = async () => {
    if (!plan) return;
    if (plan.epoch !== epoch.current.value)
      throw Error(say('正文已变化，请重新检查', 'Document changed. Check again.'));
    const p = plan;
    const ticket = epoch.current.value;
    await (p.kind === 'critic'
      ? api.confirm(p.value.id, sensitive)
      : inlineEditController.confirm(p.value.id, sensitive));
    if (ticket !== epoch.current.value) {
      if (p.kind === 'critic') await api.cancel(p.value.id);
      return;
    }
    setPlan(null);
    pending.current = null;
    running.current = { kind: p.kind, id: p.value.requestId };
    setGenerating(true);
    try {
      if (p.kind === 'critic') {
        const r = await api.start(p.value.id);
        if (ticket === epoch.current.value) setView((v) => (v ? { ...v, llm: r } : v));
      } else {
        const next = await inlineEditController.start(p.value.id, () => undefined);
        if (ticket !== epoch.current.value) {
          await inlineEditController.discard(next.review);
          return;
        }
        setProposal(next);
      }
    } finally {
      running.current = null;
      setGenerating(false);
    }
  };
  const label = (kind: string) =>
    ({
      terminology: say('术语', 'Terminology'),
      forbidden_word: say('禁用词', 'Avoided word'),
      heading: say('标题层级', 'Headings'),
      paragraph_length: say('段落长度', 'Paragraph length'),
      sentence_length: say('句子长度', 'Sentence length'),
      repetition: say('重复', 'Repetition'),
      missing_citation: say('数字来源待核对', 'Check number sources'),
      citation: say('引用待核对', 'Check citation'),
      logic: say('疑似逻辑问题', 'Possible logic issue'),
      style: say('风格建议', 'Style'),
      conclusion: say('结论建议', 'Conclusion'),
    })[kind] ?? kind;
  const evidenceLabel = (value: string) =>
    zh
      ? ({
          unknown: '未知引用',
          stale: '来源或正文已变化',
          unavailable: '来源已不可用',
          revoked: '来源授权已撤销',
        }[value] ?? value)
      : value;
  if (
    !snapshot ||
    !snapshot.editable ||
    !['markdown', 'text', 'plain_text', 'plaintext', 'txt'].includes(snapshot.format)
  )
    return null;
  const reports = view ? [view.local, ...(view.llm ? [view.llm] : [])].filter(matches) : [];
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        {say('文档审稿', 'Document review')}
      </Button>
      <Drawer title={say('文档审稿', 'Document review')} open={open} onClose={close} size={540}>
        <p>
          {say(
            '本地规则不发送正文。提示仅供核对，不会自动修改；来源有效不等于事实正确。',
            'Local checks do not send text. Findings are suggestions and never change the document automatically.'
          )}
        </p>
        {error && (
          <Alert
            type="error"
            title={userFacingError(error, locale)}
            closable
            onClose={() => setError('')}
          />
        )}
        {snapshot?.format === 'markdown' &&
          /^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*\n[ \t]*\1\s*$/.test(snapshot.text) && (
            <Alert
              key={snapshot.contentHash}
              type="info"
              showIcon
              closable
              title={say(
                '正文似乎被代码块标记包裹，代码中的禁用词不会提示。若这是文章正文，请删除首尾的代码块标记，保存后重新检查。',
                'The document appears wrapped in a code fence. Forbidden words in code are skipped. For prose, remove the opening and closing fences, save, and check again.'
              )}
            />
          )}
        {dirty && (
          <Alert
            type="warning"
            title={say(
              '正文未保存，旧提示已停用。保存后会重新检查。',
              'Unsaved changes. Previous findings are disabled until saved.'
            )}
            closable
          />
        )}
        <Space wrap>
          <label>
            {say('句子字数阈值', 'Sentence limit')}{' '}
            <InputNumber
              aria-label={say('句子字数阈值', 'Sentence limit')}
              min={20}
              max={1000}
              value={options.sentenceLimit}
              disabled={busy}
              onChange={(v) => v && setOptions({ ...options, sentenceLimit: v })}
            />
          </label>
          <label>
            {say('段落字数阈值', 'Paragraph limit')}{' '}
            <InputNumber
              aria-label={say('段落字数阈值', 'Paragraph limit')}
              min={50}
              max={5000}
              value={options.paragraphLimit}
              disabled={busy}
              onChange={(v) => v && setOptions({ ...options, paragraphLimit: v })}
            />
          </label>
          <Button disabled={busy || dirty} onClick={() => setRefresh((n) => n + 1)}>
            {say('重新检查', 'Check again')}
          </Button>
        </Space>
        <Space wrap style={{ margin: '16px 0' }}>
          <Select
            aria-label={say('审稿模型', 'Review model')}
            value={provider}
            options={providers.map((p) => ({ value: p.id, label: `${p.id} · ${p.model}` }))}
            onChange={setProvider}
            disabled={busy}
            style={{ width: 260 }}
          />
          <Button
            disabled={busy || dirty || !view || !matches(view.local)}
            onClick={() =>
              void work(async () => {
                if (!view) return;
                const ticket = epoch.current.value;
                const next = await api.plan(view.local.id, provider);
                if (ticket !== epoch.current.value) {
                  await api.cancel(next.id);
                  return;
                }
                pending.current = { kind: 'critic', value: next, epoch: ticket, bindingKey: key };
                setPlan(pending.current);
                setSensitive(false);
              })
            }
          >
            {say('AI 深度审稿', 'AI review')}
          </Button>
          {busy && generating && (
            <Button
              danger
              onClick={() => {
                const request = running.current;
                if (request?.kind === 'critic') void api.cancel(request.id);
                if (request?.kind === 'fix') void inlineEditController.stop(request.id);
              }}
            >
              {say('停止生成', 'Stop generation')}
            </Button>
          )}
        </Space>
        <Checkbox checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)}>
          {say('显示已忽略提示', 'Show ignored findings')}
        </Checkbox>
        {reports.map((r) => (
          <section
            key={r.id}
            aria-label={
              r.engine === 'local'
                ? say('本地规则提示', 'Local findings')
                : say('AI 审稿提示', 'AI findings')
            }
          >
            <h3>
              {r.engine === 'local'
                ? say('本地规则', 'Local rules')
                : say('AI 建议（待人工核对）', 'AI suggestions (review required)')}
            </h3>
            {r.engine === 'llm' && (
              <p>
                {r.engineVersion === 'web-mock'
                  ? say('演示模式', 'Demo mode')
                  : r.engineVersion.replace(/^critic-v[\d.]+:/, '').replace(':', ' · ')}
              </p>
            )}
            {r.truncated && (
              <Alert
                type="info"
                title={say(
                  '本次最多展示 100 项提示，请处理后重新检查。',
                  'Showing at most 100 findings. Check again after addressing them.'
                )}
                closable
              />
            )}
            {!r.findings.filter((f) => showIgnored || !f.ignored).length && (
              <Empty
                description={say(
                  '本次未发现符合这些规则的提示，不代表全文已核实。',
                  'No findings for these checks; this does not certify the document.'
                )}
              />
            )}
            {r.findings
              .filter((f) => showIgnored || !f.ignored)
              .map((f) => (
                <article
                  key={f.id}
                  style={{
                    border: '1px solid #d9dfe7',
                    borderRadius: 8,
                    padding: 12,
                    margin: '12px 0',
                  }}
                >
                  <Space wrap>
                    <Tag>{label(f.kind)}</Tag>
                    <span>
                      {say('第', 'Line')} {f.line} {zh ? '行' : ''}
                    </span>
                    {f.ignored && <Tag>{say('已忽略', 'Ignored')}</Tag>}
                  </Space>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{f.message}</p>
                  <blockquote style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                    {f.quote}
                  </blockquote>
                  {f.evidence && (
                    <p>
                      {say('核对依据：', 'Evidence: ')}
                      {evidenceLabel(f.evidence)}
                    </p>
                  )}
                  <Space wrap>
                    <Button disabled={busy} onClick={() => setSelected({ report: r, finding: f })}>
                      {say('查看原文', 'View passage')}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void work(async () => {
                          const next = await api.ignore(r.id, f.id, !f.ignored);
                          setView((v) =>
                            v ? { ...v, [r.engine === 'local' ? 'local' : 'llm']: next } : v
                          );
                        })
                      }
                    >
                      {f.ignored ? say('恢复提示', 'Restore') : say('忽略', 'Ignore')}
                    </Button>
                    <Button
                      disabled={busy || f.ignored}
                      onClick={() => void work(() => prepareFix(r, f))}
                    >
                      {say('让 AI 修改', 'Ask AI to revise')}
                    </Button>
                  </Space>
                </article>
              ))}
          </section>
        ))}
      </Drawer>
      <Modal
        title={say('原文位置', 'Passage location')}
        open={!!selected && matches(selected.report) && open}
        onCancel={() => setSelected(null)}
        footer={null}
      >
        {selected && (
          <>
            <p>
              {say('第', 'Line')} {selected.finding.line} {zh ? '行' : ''}
            </p>
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>
              {selected.finding.quote}
            </pre>
          </>
        )}
      </Modal>
      <Modal
        title={say('确认本次审稿发送范围', 'Confirm review data')}
        open={!!plan && open && plan.bindingKey === key}
        onCancel={() => {
          if (plan?.kind === 'critic') void api.cancel(plan.value.id);
          pending.current = null;
          setPlan(null);
        }}
        footer={null}
        width={720}
      >
        {plan && (
          <>
            <ContextManifestSummary manifest={plan.value.manifest} />
            {plan.value.manifest.requiresSensitiveConfirmation && (
              <Checkbox checked={sensitive} onChange={(e) => setSensitive(e.target.checked)}>
                {say(
                  '我确认发送上述可能敏感的资料',
                  'I confirm sending potentially sensitive data'
                )}
              </Checkbox>
            )}
            <Button
              type="primary"
              loading={busy}
              disabled={plan.value.manifest.requiresSensitiveConfirmation && !sensitive}
              onClick={() => void work(send)}
            >
              {say('确认并开始', 'Confirm and start')}
            </Button>
          </>
        )}
      </Modal>
      <Modal
        title={say('审阅修改提案', 'Review revision')}
        open={
          !!proposal &&
          open &&
          !dirty &&
          proposal.selection.contentHash === snapshot.contentHash &&
          JSON.stringify(proposal.selection.target) === JSON.stringify(snapshot.target) &&
          proposal.selection.revisionId === snapshot.revisionId
        }
        onCancel={() => {
          if (proposal) void inlineEditController.discard(proposal.review);
          setProposal(null);
        }}
        footer={null}
        width={760}
      >
        {proposal && (
          <>
            <h4>{say('修改前', 'Before')}</h4>
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
              {proposal.review.blocks[0]?.before}
            </pre>
            <h4>{say('修改后', 'After')}</h4>
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
              {proposal.replacement}
            </pre>
            <Tag>
              {say('风险：', 'Risk: ')}
              {proposal.review.risk === 'low'
                ? say('低', 'low')
                : say('需仔细核对', 'review carefully')}
            </Tag>
            <Button
              type="primary"
              loading={busy}
              onClick={() =>
                void work(async () => {
                  const s = current.current;
                  if (
                    !s ||
                    JSON.stringify(s.target) !== JSON.stringify(proposal.selection.target) ||
                    s.hasUnsavedDraft ||
                    s.contentHash !== proposal.selection.contentHash ||
                    s.revisionId !== proposal.selection.revisionId
                  )
                    throw Error('正文已变化，请重新审稿');
                  const application = await inlineEditController.accept(proposal.review);
                  await onApplied(application);
                  setProposal(null);
                  setRefresh((v) => v + 1);
                })
              }
            >
              {say('接受并写入', 'Accept and apply')}
            </Button>
          </>
        )}
      </Modal>
    </>
  );
}
