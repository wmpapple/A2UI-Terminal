import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Tabs,
  Tag,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { useAppStore } from '../../stores/useAppStore';
import { errorDetails } from '../../stores/support';
import type { ContextPack, DocumentSource } from '../../shared/types/domain';
import type {
  OutlineSection,
  ProjectConfig,
  ProjectView,
  WritingPlan,
  WritingProject,
} from '../../shared/types/writingProject';
import { KnowledgePicker } from '../knowledge/KnowledgePicker';
import { importController } from '../imports/importController';
import { contextPackController } from '../contextPacks/contextPackController';
import { ContextManifestSummary } from '../context/components/ContextManifestSummary';
import { AssistantMarkdown } from '../chat/components/ChatMessageList';
import { writingProjectController as api } from './writingProjectController';
import { SectionReview } from './SectionReview';
import styles from './WritingProjectsPage.module.css';

const emptyConfig = (): ProjectConfig => ({
  title: '',
  goal: '',
  audience: '',
  facts: '',
  terminology: '',
  knowledgeIds: [],
  documentSourceIds: [],
  contextPackIds: [],
});
const outlineRows = (p: WritingProject): OutlineSection[] =>
  p.sections.map(({ id, title, objective, targetWords }) => ({
    id,
    title,
    objective,
    targetWords,
  }));
// Navigation preserves unsaved setup fields; accepted content and section drafts live in SQLite.
const navigationDrafts = new Map<
  string,
  { id: string | null; config: ProjectConfig; rows: OutlineSection[]; tab: string }
>();
export function WritingProjectsPage({ onOpenResult }: { onOpenResult: (id: string) => void }) {
  const selectedWorkspace = useAppStore((s) => s.workspace);
  const runtime = useAppStore((s) => s.runtimeMode);
  const workspace =
    selectedWorkspace ??
    (runtime === 'web-mock' ? { id: 'web-mock-workspace', name: 'Web Mock' } : null);
  const { locale } = useI18n();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  if (!workspace)
    return (
      <Card title={locale === 'zh-CN' ? '开始长文写作' : 'Start a writing project'}>
        <p>
          {locale === 'zh-CN'
            ? '创建写作空间后，即可设置目标、选择资料并编写大纲。'
            : 'Create a writing workspace to set a goal, choose sources and prepare an outline.'}
        </p>
        {startError && <Alert type="error" title={startError} closable />}
        <Button
          type="primary"
          loading={starting}
          onClick={async () => {
            setStarting(true);
            try {
              const created = await api.createWorkspace();
              await useAppStore.getState().restoreWorkspace(created.id);
            } catch (e) {
              setStartError(errorDetails(e).message);
            } finally {
              setStarting(false);
            }
          }}
        >
          {locale === 'zh-CN' ? '创建写作空间' : 'Create writing workspace'}
        </Button>
      </Card>
    );
  return (
    <ProjectsWorkspace
      key={workspace.id}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      onOpenResult={onOpenResult}
    />
  );
}
function ProjectsWorkspace({
  workspaceId,
  workspaceName,
  onOpenResult,
}: {
  workspaceId: string;
  workspaceName: string;
  onOpenResult: (id: string) => void;
}) {
  const { locale } = useI18n();
  const say = (cn: string, en: string) => (locale === 'zh-CN' ? cn : en);
  const providers = useAppStore((s) => s.providerConfigs);
  const activeProvider = useAppStore((s) => s.activeProviderId);
  const cached = navigationDrafts.get(workspaceId);
  const [projects, setProjects] = useState<WritingProject[]>([]);
  const [id, setId] = useState<string | null>(cached?.id ?? null);
  const [view, setView] = useState<ProjectView | null>(null);
  const [config, setConfig] = useState<ProjectConfig>(cached?.config ?? emptyConfig());
  const [rows, setRows] = useState<OutlineSection[]>(cached?.rows ?? []);
  const [tab, setTab] = useState(cached?.tab ?? 'setup');
  const [sectionId, setSectionId] = useState('');
  const [runId, setRunId] = useState('');
  const [providerId, setProviderId] = useState(activeProvider);
  const [instruction, setInstruction] = useState('');
  const [documents, setDocuments] = useState<DocumentSource[]>([]);
  const [packs, setPacks] = useState<ContextPack[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<WritingPlan | null>(null);
  const [sensitive, setSensitive] = useState(false);
  const [streamId, setStreamId] = useState<string | null>(null);
  const activeId = useRef(id);
  const pendingPlan = useRef<string | null>(null);
  const epoch = useRef(0);
  const project = view?.project ?? null;
  const runs = view?.runs ?? [];
  const running = runs.find((r) => r.status === 'running');
  const locked = busy || !!running || !!project?.finalReviewId;
  const configDirty = !!project && JSON.stringify(config) !== JSON.stringify(project.config);
  const outlineDirty = !!project && JSON.stringify(rows) !== JSON.stringify(outlineRows(project));
  const section = project?.sections.find((s) => s.id === sectionId) ?? project?.sections[0];
  const sectionRuns = runs.filter((r) => r.sectionId === section?.id);
  const selectedRun = sectionRuns.find((r) => r.id === runId) ?? sectionRuns[0];
  const outlineRun = runs.find((r) => r.sectionId === null && r.status === 'review');
  const updateConfig = <K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));
  const refreshList = () => api.list(workspaceId).then(setProjects);
  const load = async (projectId: string, hydrate = false) => {
    const data = await api.get(projectId);
    if (activeId.current !== projectId) return;
    setView(data);
    if (hydrate) {
      setConfig(data.project.config);
      setRows(outlineRows(data.project));
    }
    return data;
  };
  const work = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorDetails(e).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    navigationDrafts.set(workspaceId, { id, config, rows, tab });
  }, [workspaceId, id, config, rows, tab]);
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      api.list(workspaceId),
      importController.listSources(workspaceId),
      contextPackController.list(workspaceId),
    ])
      .then(([items, docs, sourcePacks]) => {
        if (!mounted) return;
        setProjects(items);
        setDocuments(docs.filter((d) => d.kind !== 'image'));
        setPacks(sourcePacks);
      })
      .catch((e) => {
        if (mounted) setError(errorDetails(e).message);
      });
    if (activeId.current)
      void load(activeId.current).catch((e) => setError(errorDetails(e).message));
    return () => {
      mounted = false;
      // This is an async action generation counter, not a DOM element ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      if (pendingPlan.current) void api.cancel(pendingPlan.current).catch(() => {});
    };
    // Initial data only; explicit actions and the scoped run poll update this workspace.
  }, [workspaceId]);
  useEffect(() => {
    if (!id || (!streamId && !running)) return;
    const timer = setInterval(
      () => void load(id).catch((e) => setError(errorDetails(e).message)),
      800
    );
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, streamId, running?.id]);
  const select = (next: string | null) => {
    epoch.current++;
    activeId.current = next;
    setId(next);
    setView(null);
    setRunId('');
    setSectionId('');
    setError('');
    if (next)
      void work(async () => {
        await load(next, true);
      });
    else {
      setConfig(emptyConfig());
      setRows([]);
      setTab('setup');
    }
  };
  const saveProject = async () => {
    const p = await api.save({ id, workspaceId, revision: project?.revision ?? null, config });
    activeId.current = p.id;
    setId(p.id);
    setView({ project: p, runs });
    setConfig(p.config);
    await refreshList();
    return p;
  };
  const saveOutline = async (confirmed: boolean) => {
    if (!project) return;
    const p = await api.outline({
      projectId: project.id,
      revision: project.revision,
      sections: rows,
      confirmed,
    });
    setView({ project: p, runs });
    setRows(outlineRows(p));
    if (confirmed) {
      setTab('sections');
      setSectionId(p.sections[0]?.id ?? '');
    }
    await refreshList();
  };
  const prepare = async (sectionId: string | null) => {
    if (!project) return;
    const ticket = ++epoch.current;
    const next = await api.plan({
      projectId: project.id,
      revision: project.revision,
      sectionId,
      providerId,
      instruction,
    });
    if (ticket !== epoch.current) {
      void api.cancel(next.id);
      return;
    }
    pendingPlan.current = next.id;
    setPlan(next);
    setSensitive(false);
  };
  const send = async () => {
    if (!plan || !id) return;
    const current = plan;
    const currentId = id;
    await api.confirm(current.id, sensitive);
    pendingPlan.current = null;
    setPlan(null);
    setStreamId(current.requestId);
    setInstruction('');
    try {
      const run = await api.start(current.id);
      await load(currentId);
      if (activeId.current === currentId) {
        if (run.error) setError(run.error);
        if (run.sectionId) {
          setSectionId(run.sectionId);
          setRunId(run.id);
        } else if (run.status === 'review') setRows(await api.outlineProposal(run.id));
      }
      await refreshList();
    } finally {
      setStreamId(null);
    }
  };
  const updateRow = (index: number, change: Partial<OutlineSection>) =>
    setRows((value) => value.map((row, i) => (i === index ? { ...row, ...change } : row)));
  return (
    <main className={styles.page}>
      <Space align="center" wrap>
        <h1>{say('长文项目', 'Writing projects')}</h1>
        <Tag>{workspaceName}</Tag>
        <Button onClick={() => select(null)} disabled={busy}>
          {say('新建长文项目', 'New writing project')}
        </Button>
      </Space>
      <p>
        {say(
          '确认大纲 → 逐章生成与审阅 → 合成为成果。进度保存在本机，恢复时由你决定继续。',
          'Confirm an outline, review each section, then assemble a result. Progress is saved locally; you control when to resume.'
        )}
      </p>
      {error && <Alert showIcon type="error" title={error} closable onClose={() => setError('')} />}
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <h2>{say('我的长文项目', 'My projects')}</h2>
          {projects.length === 0 ? (
            <Empty description={say('还没有长文项目', 'No projects yet')} />
          ) : (
            projects.map((p) => (
              <Button
                key={p.id}
                block
                type={id === p.id ? 'primary' : 'default'}
                disabled={busy}
                onClick={() => select(p.id)}
              >
                {p.config.title}
                {p.resultId ? ' ✓' : ''}
              </Button>
            ))
          )}
        </aside>
        <div className={styles.content}>
          {project && (
            <Card size="small">
              <Space wrap>
                <strong>{project.config.title}</strong>
                <Tag>
                  {project.resultId
                    ? say('已合成成果', 'Result created')
                    : project.outlineConfirmed
                      ? say('大纲已确认', 'Outline confirmed')
                      : say('大纲待确认', 'Outline pending')}
                </Tag>
                <Popconfirm
                  title={say(
                    '删除这个长文项目及章节草稿？已合成的成果会保留。',
                    'Delete this project and its drafts? Existing results are retained.'
                  )}
                  onConfirm={() =>
                    work(async () => {
                      await api.delete(project.id);
                      select(null);
                      await refreshList();
                    })
                  }
                >
                  <Button danger disabled={!!running || busy}>
                    {say('删除项目', 'Delete project')}
                  </Button>
                </Popconfirm>
              </Space>
              <Progress
                percent={Math.round(
                  (project.sections.filter((s) => s.accepted).length /
                    Math.max(1, project.sections.length)) *
                    100
                )}
                format={() =>
                  `${project.sections.filter((s) => s.accepted).length} / ${project.sections.length} ${say('章已接受', 'accepted')}`
                }
              />
              {project.resultId && (
                <Button type="primary" onClick={() => onOpenResult(project.resultId!)}>
                  {say('打开最终成果', 'Open final result')}
                </Button>
              )}
            </Card>
          )}
          {(running || streamId) && (
            <Alert
              showIcon
              type="info"
              closable
              title={say(
                '正在生成当前章节。离开页面后进度仍会保存；不会自动开始下一章。',
                'Generating this part. Progress continues to save if you leave; the next section will not start automatically.'
              )}
              action={
                <Button
                  danger
                  onClick={() =>
                    void api
                      .cancel(running?.requestId ?? streamId!)
                      .catch((e) => setError(errorDetails(e).message))
                  }
                >
                  {say('停止生成', 'Stop')}
                </Button>
              }
            />
          )}
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'setup',
                label: say('1. 目标与资料', '1. Goal and sources'),
                children: (
                  <Card>
                    <Form layout="vertical" disabled={locked}>
                      <Form.Item label={say('项目标题', 'Project title')} required>
                        <Input
                          aria-label={say('项目标题', 'Project title')}
                          value={config.title}
                          maxLength={160}
                          onChange={(e) => updateConfig('title', e.target.value)}
                        />
                      </Form.Item>
                      <Form.Item label={say('写作目标', 'Writing goal')} required>
                        <Input.TextArea
                          aria-label={say('写作目标', 'Writing goal')}
                          value={config.goal}
                          maxLength={4000}
                          rows={3}
                          onChange={(e) => updateConfig('goal', e.target.value)}
                        />
                      </Form.Item>
                      <Form.Item label={say('目标读者', 'Audience')}>
                        <Input
                          value={config.audience}
                          maxLength={500}
                          onChange={(e) => updateConfig('audience', e.target.value)}
                        />
                      </Form.Item>
                      <Form.Item
                        label={say('关键事实与未决事项', 'Key facts and unresolved matters')}
                      >
                        <Input.TextArea
                          aria-label={say('关键事实与未决事项', 'Key facts and unresolved matters')}
                          value={config.facts}
                          maxLength={4000}
                          rows={3}
                          onChange={(e) => updateConfig('facts', e.target.value)}
                        />
                      </Form.Item>
                      <Form.Item
                        label={say(
                          '项目术语（同时遵循写作偏好）',
                          'Project terminology (writing preferences also apply)'
                        )}
                      >
                        <Input.TextArea
                          value={config.terminology}
                          maxLength={2000}
                          rows={2}
                          onChange={(e) => updateConfig('terminology', e.target.value)}
                        />
                      </Form.Item>
                      <Form.Item label={say('个人资料', 'Personal sources')}>
                        <KnowledgePicker
                          value={config.knowledgeIds}
                          onChange={(v) => updateConfig('knowledgeIds', v)}
                          disabled={locked}
                        />
                      </Form.Item>
                      <Form.Item label={say('工作区授权资料', 'Authorized workspace sources')}>
                        <Select
                          mode="multiple"
                          value={config.documentSourceIds}
                          options={documents.map((d) => ({ value: d.id, label: d.name }))}
                          onChange={(v) => updateConfig('documentSourceIds', v)}
                        />
                      </Form.Item>
                      <Form.Item label={say('资料包', 'Source packs')}>
                        <Select
                          mode="multiple"
                          value={config.contextPackIds}
                          options={packs.map((p) => ({ value: p.id, label: p.name }))}
                          onChange={(v) => updateConfig('contextPackIds', v)}
                        />
                      </Form.Item>
                      <Button
                        type="primary"
                        loading={busy}
                        disabled={!config.title.trim() || !config.goal.trim()}
                        onClick={() =>
                          void work(async () => {
                            await saveProject();
                            setTab('outline');
                          })
                        }
                      >
                        {say('保存项目并编辑大纲', 'Save project and edit outline')}
                      </Button>
                      {configDirty && (
                        <p>
                          {say(
                            '项目设置尚未保存；保存后需重新确认大纲与已有章节。',
                            'Unsaved settings. Saving requires reviewing the outline and existing sections again.'
                          )}
                        </p>
                      )}
                    </Form>
                  </Card>
                ),
              },
              {
                key: 'outline',
                label: say('2. 确认大纲', '2. Outline'),
                disabled: !project,
                children: (
                  <Card>
                    <Space wrap>
                      <Select
                        aria-label={say('写作模型服务', 'Writing provider')}
                        value={providerId}
                        options={providers.map((p) => ({
                          value: p.id,
                          label: `${p.id} · ${p.model}`,
                        }))}
                        onChange={setProviderId}
                        disabled={locked}
                        style={{ minWidth: 260 }}
                      />
                      <Button
                        disabled={locked || configDirty}
                        onClick={() => void work(() => prepare(null))}
                      >
                        {say('AI 生成大纲', 'Generate outline with AI')}
                      </Button>
                      {outlineRun && (
                        <Button
                          disabled={locked}
                          onClick={() =>
                            void work(async () => {
                              setRows(await api.outlineProposal(outlineRun.id));
                            })
                          }
                        >
                          {say('载入 AI 大纲提案', 'Load outline proposal')}
                        </Button>
                      )}
                    </Space>
                    <p>
                      {say(
                        'AI 大纲需要你确认。也可以直接手动添加章节，建议长度用于指导模型。',
                        'Review the proposed outline, or add sections manually. Lengths guide the model.'
                      )}
                    </p>
                    {rows.map((row, index) => (
                      <div className={styles.outlineRow} key={row.id ?? index}>
                        <strong>{index + 1}</strong>
                        <div>
                          <Input
                            aria-label={`${say('章节标题', 'Section title')} ${index + 1}`}
                            placeholder={say('章节标题', 'Section title')}
                            value={row.title}
                            maxLength={160}
                            disabled={locked}
                            onChange={(e) => updateRow(index, { title: e.target.value })}
                          />
                          <Input.TextArea
                            aria-label={`${say('章节目标', 'Section objective')} ${index + 1}`}
                            placeholder={say(
                              '本章要回答的问题',
                              'What should this section answer?'
                            )}
                            value={row.objective}
                            maxLength={1000}
                            disabled={locked}
                            onChange={(e) => updateRow(index, { objective: e.target.value })}
                          />
                        </div>
                        <Space orientation="vertical">
                          <InputNumber
                            aria-label={`${say('建议字数', 'Target length')} ${index + 1}`}
                            value={row.targetWords}
                            min={100}
                            max={5000}
                            disabled={locked}
                            onChange={(v) => updateRow(index, { targetWords: v ?? 500 })}
                          />
                          <Button
                            disabled={locked}
                            onClick={() => setRows((v) => v.filter((_, i) => i !== index))}
                          >
                            {say('移除章节', 'Remove')}
                          </Button>
                          <Button
                            disabled={locked || index === 0}
                            onClick={() =>
                              setRows((v) => {
                                const next = [...v];
                                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                return next;
                              })
                            }
                          >
                            {say('上移', 'Move up')}
                          </Button>
                        </Space>
                      </div>
                    ))}
                    <Space wrap>
                      <Button
                        disabled={locked || rows.length >= 12}
                        onClick={() =>
                          setRows((v) => [
                            ...v,
                            { id: null, title: '', objective: '', targetWords: 500 },
                          ])
                        }
                      >
                        {say('添加章节', 'Add section')}
                      </Button>
                      <Button
                        disabled={locked || !rows.length || configDirty}
                        onClick={() => void work(() => saveOutline(false))}
                      >
                        {say('保存大纲草稿', 'Save outline draft')}
                      </Button>
                      <Button
                        type="primary"
                        disabled={locked || !rows.length || configDirty}
                        onClick={() => void work(() => saveOutline(true))}
                      >
                        {say('确认大纲，进入章节', 'Confirm outline and continue')}
                      </Button>
                    </Space>
                    {outlineDirty && (
                      <p>
                        {say(
                          '大纲有未确认的修改。重新确认后，已有章节正文会保留并等待复核。',
                          'The outline has unconfirmed edits. Existing text is retained for review.'
                        )}
                      </p>
                    )}
                  </Card>
                ),
              },
              {
                key: 'sections',
                label: say('3. 章节与成果', '3. Sections and result'),
                disabled: !project?.sections.length,
                children: (
                  <Card>
                    <Space wrap>
                      <Select
                        aria-label={say('当前章节', 'Current section')}
                        value={section?.id}
                        options={project?.sections.map((s, i) => ({
                          value: s.id,
                          label: `${i + 1}. ${s.title} · ${s.accepted ? say('已接受', 'Accepted') : say('待审阅', 'Pending')}`,
                        }))}
                        onChange={(value) => {
                          setSectionId(value);
                          setRunId('');
                        }}
                        style={{ minWidth: 260 }}
                        disabled={busy}
                      />
                      <Select
                        aria-label={say('章节写作服务', 'Section provider')}
                        value={providerId}
                        options={providers.map((p) => ({
                          value: p.id,
                          label: `${p.id} · ${p.model}`,
                        }))}
                        onChange={setProviderId}
                        disabled={locked}
                      />
                    </Space>
                    {section && (
                      <>
                        <p>
                          {section.objective} · {say('建议', 'Target')} {section.targetWords}{' '}
                          {say('字', 'words')}
                        </p>
                        <Input.TextArea
                          aria-label={say('本章额外要求', 'Additional section instruction')}
                          placeholder={say(
                            '可填写：扩写、精简、重写角度等。本次只处理当前章。',
                            'Optional: expand, shorten, or change the approach for this section.'
                          )}
                          value={instruction}
                          maxLength={2000}
                          disabled={locked}
                          onChange={(e) => setInstruction(e.target.value)}
                        />
                        <Space wrap style={{ margin: '12px 0' }}>
                          <Button
                            type="primary"
                            disabled={
                              locked || configDirty || outlineDirty || !project?.outlineConfirmed
                            }
                            onClick={() => void work(() => prepare(section.id))}
                          >
                            {say('规划本章生成', 'Review section generation')}
                          </Button>
                          {sectionRuns.length > 0 && (
                            <Select
                              aria-label={say('章节候选记录', 'Section proposals')}
                              value={selectedRun?.id}
                              options={sectionRuns.map((r, i) => ({
                                value: r.id,
                                label: `${say('候选', 'Proposal')} ${sectionRuns.length - i} · ${r.createdAt}`,
                              }))}
                              onChange={setRunId}
                              disabled={busy}
                            />
                          )}
                        </Space>
                      </>
                    )}
                    {selectedRun?.error && (
                      <Alert showIcon type="warning" title={selectedRun.error} closable />
                    )}
                    {selectedRun?.status === 'running' ? (
                      <AssistantMarkdown content={selectedRun.content} streaming />
                    ) : selectedRun && section ? (
                      <SectionReview
                        key={selectedRun.id}
                        run={selectedRun}
                        section={section}
                        disabled={locked || configDirty || outlineDirty}
                        onAccept={(content, summary) =>
                          work(async () => {
                            const p = await api.accept({
                              projectId: project!.id,
                              revision: project!.revision,
                              sectionId: section.id,
                              runId: selectedRun.id,
                              content,
                              summary,
                            });
                            setView({ project: p, runs });
                            await refreshList();
                          })
                        }
                      />
                    ) : (
                      <Empty
                        description={say(
                          '先生成当前章节，然后在这里审阅。',
                          'Generate this section to review it here.'
                        )}
                      />
                    )}
                    {section?.accepted && (
                      <Alert
                        style={{ marginTop: 12 }}
                        type="success"
                        showIcon
                        closable
                        title={say(
                          '本章已接受。调整本章后，后续章节需要重新核对。',
                          'Section accepted. Editing it requires reviewing later sections again.'
                        )}
                      />
                    )}
                    {project && (
                      <div className={styles.final}>
                        <details>
                          <summary>
                            {say('查看已接受章节组成的全文', 'Preview accepted sections')}
                          </summary>
                          <AssistantMarkdown
                            content={
                              `# ${project.config.title}\n\n` +
                              project.sections
                                .filter((s) => s.accepted)
                                .map((s) => `## ${s.title}\n\n${s.content}`)
                                .join('\n\n')
                            }
                            streaming={false}
                          />
                        </details>
                        <Button
                          type="primary"
                          disabled={
                            busy ||
                            !!running ||
                            configDirty ||
                            outlineDirty ||
                            !project.sections.length ||
                            project.sections.some((s) => !s.accepted)
                          }
                          onClick={() =>
                            void work(async () => {
                              const result = await api.finalize(project.id, project.revision);
                              await load(project.id);
                              await refreshList();
                              onOpenResult(result);
                            })
                          }
                        >
                          {project.resultId
                            ? say('打开最终成果', 'Open final result')
                            : say('合成为最终成果', 'Assemble final result')}
                        </Button>
                      </div>
                    )}
                  </Card>
                ),
              },
            ]}
          />
        </div>
      </div>
      <Modal
        open={!!plan}
        title={say('确认本次长文发送范围', 'Confirm writing request')}
        onCancel={() => {
          if (plan) void api.cancel(plan.id);
          pendingPlan.current = null;
          epoch.current++;
          setPlan(null);
        }}
        footer={null}
        width={720}
      >
        {plan && (
          <>
            <ContextManifestSummary manifest={plan.manifest} />
            <details>
              <summary>
                {say('任务、章节与事实摘要', 'Task, section and continuity context')}
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>
                {plan.prompt}
              </pre>
            </details>
            {plan.manifest.requiresSensitiveConfirmation && (
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
              disabled={plan.manifest.requiresSensitiveConfirmation && !sensitive}
              onClick={() => void work(send)}
            >
              {say('确认并开始本次生成', 'Confirm and generate')}
            </Button>
          </>
        )}
      </Modal>
    </main>
  );
}
