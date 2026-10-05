import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Tabs,
  Tag,
} from 'antd';
import { BookOutlined, HolderOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { WorkItemHeader, WorkItemNavigation } from '../../app/WorkItemFrame';
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
import { AssistantMarkdown } from '../chat/components/ChatMessageList';
import { writingProjectController as api } from './writingProjectController';
import { SectionReview } from './SectionReview';
import { WritingSendSummary } from './WritingSendSummary';
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
interface WritingProjectsPageProps {
  onOpenResult: (id: string) => void;
  embedded?: boolean;
  projectId?: string | null;
  initialTab?: string;
  onProjectCreated?: (id: string) => void;
  onProjectChanged?: () => void;
  onProjectDeleted?: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  chapterId?: string | null;
  professional?: boolean;
  onOpenSection?: (sectionId: string) => void;
  onOpenProject?: () => void;
  onOpenSettings?: () => void;
}

export function WritingProjectsPage({
  onOpenResult,
  embedded,
  projectId,
  initialTab,
  onProjectCreated,
  onProjectChanged,
  onProjectDeleted,
  onDirtyChange,
  chapterId,
  professional,
  onOpenSection,
  onOpenProject,
  onOpenSettings,
}: WritingProjectsPageProps) {
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
      embedded={embedded}
      projectId={projectId}
      initialTab={initialTab}
      onProjectCreated={onProjectCreated}
      onProjectChanged={onProjectChanged}
      onProjectDeleted={onProjectDeleted}
      onDirtyChange={onDirtyChange}
      chapterId={chapterId}
      professional={professional}
      onOpenSection={onOpenSection}
      onOpenProject={onOpenProject}
      onOpenSettings={onOpenSettings}
    />
  );
}
function ProjectsWorkspace({
  workspaceId,
  workspaceName,
  onOpenResult,
  embedded = false,
  projectId,
  initialTab,
  onProjectCreated,
  onProjectChanged,
  onProjectDeleted,
  onDirtyChange,
  chapterId,
  professional = false,
  onOpenSection,
  onOpenProject,
  onOpenSettings,
}: {
  workspaceId: string;
  workspaceName: string;
} & WritingProjectsPageProps) {
  const { locale } = useI18n();
  const say = (cn: string, en: string) => (locale === 'zh-CN' ? cn : en);
  const providers = useAppStore((s) => s.providerConfigs);
  const runtimeMode = useAppStore((s) => s.runtimeMode);
  const activeProvider = useAppStore((s) => s.activeProviderId);
  const draftKey = `${workspaceId}:${embedded ? (projectId ?? 'new') : 'standalone'}`;
  const cachedDraft = navigationDrafts.get(draftKey);
  const cached = chapterId || (embedded && !projectId && cachedDraft?.id) ? undefined : cachedDraft;
  const hydrateInitial = useRef(Boolean(chapterId) || (embedded && !cached));
  const [projects, setProjects] = useState<WritingProject[]>([]);
  const [id, setId] = useState<string | null>(
    embedded ? (projectId ?? null) : (cached?.id ?? null)
  );
  const [view, setView] = useState<ProjectView | null>(null);
  const [config, setConfig] = useState<ProjectConfig>(cached?.config ?? emptyConfig());
  const [rows, setRows] = useState<OutlineSection[]>(cached?.rows ?? []);
  const [tab, setTab] = useState(chapterId ? 'sections' : (initialTab ?? cached?.tab ?? 'setup'));
  const [sectionId, setSectionId] = useState(chapterId ?? '');
  const [runId, setRunId] = useState('');
  const [providerId, setProviderId] = useState(activeProvider);
  const [instruction, setInstruction] = useState('');
  const [documents, setDocuments] = useState<DocumentSource[]>([]);
  const [packs, setPacks] = useState<ContextPack[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<WritingPlan | null>(null);
  const [planSectionId, setPlanSectionId] = useState<string | null>(null);
  const [sensitive, setSensitive] = useState(false);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [draggedRow, setDraggedRow] = useState<number | null>(null);
  const activeId = useRef(id);
  const pendingPlan = useRef<string | null>(null);
  const epoch = useRef(0);
  const project = view?.project ?? null;
  const runs = view?.runs ?? [];
  const running = runs.find((r) => r.status === 'running');
  const locked = busy || !!running || (!!project?.finalReviewId && !project.resultId);
  const resultOutdated = !!project?.resultId && project.publishedRevision !== project.revision;
  const configDirty = !!project && JSON.stringify(config) !== JSON.stringify(project.config);
  const outlineDirty = !!project && JSON.stringify(rows) !== JSON.stringify(outlineRows(project));
  const draftDirty = project
    ? configDirty || outlineDirty
    : Boolean(
        config.title.trim() ||
        config.goal.trim() ||
        config.audience.trim() ||
        config.facts.trim() ||
        config.terminology.trim() ||
        config.knowledgeIds.length ||
        config.documentSourceIds.length ||
        config.contextPackIds.length ||
        rows.length
      );
  useEffect(() => onDirtyChange?.(draftDirty), [draftDirty, onDirtyChange]);
  const section = project?.sections.find((s) => s.id === sectionId) ?? project?.sections[0];
  const completedCount = project?.sections.filter((item) => item.accepted).length ?? 0;
  const stage = !project ? 'setup' : !project.outlineConfirmed ? 'outline' : 'sections';
  const model = providers.find((item) => item.id === providerId);
  const modelConfigured = Boolean(model?.configured) || runtimeMode === 'web-mock';
  const sectionRuns = runs.filter((r) => r.sectionId === section?.id);
  const selectedRun = sectionRuns.find((r) => r.id === runId) ?? sectionRuns[0];
  const outlineRun = runs.find((r) => r.sectionId === null && r.status === 'review');
  const updateConfig = <K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));
  const refreshList = () =>
    api.list(workspaceId).then((items) => {
      setProjects(items);
      onProjectChanged?.();
    });
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
    navigationDrafts.set(draftKey, { id, config, rows, tab });
  }, [draftKey, id, config, rows, tab]);
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
      void load(activeId.current, hydrateInitial.current).catch((e) =>
        setError(errorDetails(e).message)
      );
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
    const creating = !id;
    const p = await api.save({ id, workspaceId, revision: project?.revision ?? null, config });
    activeId.current = p.id;
    setId(p.id);
    setView({ project: p, runs });
    setConfig(p.config);
    await refreshList();
    if (creating) navigationDrafts.delete(draftKey);
    if (creating) onProjectCreated?.(p.id);
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
      if (p.sections[0]) openChapter(p.sections[0].id);
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
    setPlanSectionId(sectionId);
    setSensitive(false);
  };
  const send = async () => {
    if (!plan || !id) return;
    const current = plan;
    const currentId = id;
    await api.confirm(current.id, sensitive);
    pendingPlan.current = null;
    setPlan(null);
    setPlanSectionId(null);
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
  const moveRow = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= rows.length) return;
    setRows((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };
  const openChapter = (nextId: string) => {
    if (embedded && onOpenSection) onOpenSection(nextId);
    else {
      setSectionId(nextId);
      setTab('sections');
    }
  };
  const stageLabel = (step: number, title: string, complete: boolean, current: boolean) =>
    `${step} ${title} ${complete ? '✓' : current ? '●' : '○'}`;
  const publishResult = () =>
    work(async () => {
      if (!project) return;
      const result = await api.finalize(project.id, project.revision);
      await load(project.id);
      await refreshList();
      onOpenResult(result);
    });
  return (
    <main className={`${styles.page} ${embedded ? styles.embedded : ''}`}>
      {!embedded && (
        <Space align="center" wrap>
          <h1>{say('长文项目', 'Writing projects')}</h1>
          <Tag>{workspaceName}</Tag>
          <Button onClick={() => select(null)} disabled={busy}>
            {say('新建长文项目', 'New writing project')}
          </Button>
        </Space>
      )}
      {!embedded && (
        <p>
          {say(
            '确认大纲 → 逐章生成与审阅 → 合成为成果。进度保存在本机，恢复时由你决定继续。',
            'Confirm an outline, review each section, then assemble a result. Progress is saved locally; you control when to resume.'
          )}
        </p>
      )}
      {error && <Alert showIcon type="error" title={error} closable onClose={() => setError('')} />}
      <div className={`${styles.layout} ${embedded ? styles.embeddedLayout : ''}`}>
        {!embedded && (
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
        )}
        <div className={styles.content}>
          {embedded && chapterId && project && (
            <WorkItemHeader
              icon={<BookOutlined />}
              title={section?.title}
              type={say('长文项目章节', 'Writing project section')}
              status={section?.accepted ? say('已接受', 'Accepted') : say('写作中', 'Writing')}
              tone={section?.accepted ? 'success' : 'warning'}
              actions={<Button type="link" onClick={onOpenProject}>{project.config.title}</Button>}
            />
          )}
          {embedded && !chapterId && (
            <WorkItemHeader
              icon={<BookOutlined />}
              title={project?.config.title || config.title || say('新建长文项目', 'New writing project')}
              type={say('长文项目', 'Writing project')}
              status={project ? (
                project.resultId
                  ? resultOutdated
                    ? say('内容比成果更新', 'Newer than result')
                    : say('已有成果', 'Result saved')
                  : project.outlineConfirmed
                    ? say('写作中', 'Writing')
                    : say('大纲待确认', 'Outline pending')
              ) : say('待设置', 'Setup pending')}
              tone={project?.resultId && !resultOutdated ? 'success' : 'warning'}
              details={project?.sections.length ? (
                <span>{completedCount} / {project.sections.length} {say('节完成', 'sections complete')}</span>
              ) : undefined}
              progress={project?.sections.length ? (
                <Progress percent={Math.round((completedCount / project.sections.length) * 100)} showInfo={false} size="small" />
              ) : undefined}
              actions={project ? (
                <Space size="small">
                  {project.resultId && <Button size="small" type="link" onClick={() => onOpenResult(project.resultId!)}>{say('查看成果', 'View result')}</Button>}
                  <Dropdown
                    menu={{
                      items: [
                        {
                          key: 'delete',
                          label: say('删除项目', 'Delete project'),
                          danger: true,
                          disabled: !!running || busy,
                          onClick: () =>
                            Modal.confirm({
                              title: say(
                                '删除这个长文项目及章节草稿？已保存的成果会保留。',
                                'Delete this project and its drafts? Existing results are retained.'
                              ),
                              okText: say('删除项目', 'Delete project'),
                              okButtonProps: { danger: true },
                              onOk: () =>
                                work(async () => {
                                  await api.delete(project.id);
                                  select(null);
                                  await refreshList();
                                  onProjectDeleted?.(project.id);
                                }),
                            }),
                        },
                      ],
                    }}
                    trigger={['click']}
                  >
                    <Button
                      type="text"
                      icon={<MoreOutlined />}
                      aria-label={say('项目更多操作', 'More project actions')}
                      title={say('项目更多操作', 'More project actions')}
                    />
                  </Dropdown>
                </Space>
              ) : undefined}
            />
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
          <WorkItemNavigation tabs>
          <Tabs
            className={chapterId ? styles.chapterTabs : undefined}
            activeKey={tab}
            onChange={(next) => {
              if (next === 'sections' && embedded && project?.sections.length)
                openChapter(
                  project.sections.find((item) => !item.accepted)?.id ?? project.sections[0].id
                );
              else setTab(next);
            }}
            items={[
              ...(embedded && project
                ? [
                    {
                      key: 'overview',
                      label: say('概览', 'Overview'),
                      children: (
                        <section className={styles.overview}>
                          <div className={styles.overviewSummary}>
                            <div>
                              <span>{say('写作目标', 'Writing goal')}</span>
                              <p>{project.config.goal}</p>
                            </div>
                            <div>
                              <span>{say('目标读者', 'Audience')}</span>
                              <p>{project.config.audience || say('未设置', 'Not set')}</p>
                            </div>
                            <div>
                              <span>{say('资料', 'Sources')}</span>
                              <p>
                                {project.config.knowledgeIds.length +
                                  project.config.documentSourceIds.length +
                                  project.config.contextPackIds.length}{' '}
                                {say('项已选择', 'selected')}
                              </p>
                            </div>
                          </div>
                          <h2>{say('章节进度', 'Sections')}</h2>
                          {project.sections.length ? (
                            <div className={styles.chapterList}>
                              {project.sections.map((chapter, index) => (
                                <button
                                  type="button"
                                  key={chapter.id}
                                  onClick={() => {
                                    openChapter(chapter.id);
                                  }}
                                >
                                  <span>{String(index + 1).padStart(2, '0')}</span>
                                  <strong>{chapter.title}</strong>
                                  <small>
                                    {chapter.accepted
                                      ? say('已完成', 'Complete')
                                      : say('待处理', 'Pending')}
                                  </small>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <Empty
                              image={Empty.PRESENTED_IMAGE_SIMPLE}
                              description={say(
                                '先完成大纲，再逐章写作',
                                'Complete the outline to begin drafting'
                              )}
                            />
                          )}
                          <Button
                            type="primary"
                            onClick={() => {
                              if (!project.sections.length) setTab('outline');
                              else {
                                openChapter(
                                  project.sections.find((chapter) => !chapter.accepted)?.id ??
                                    project.sections[0].id
                                );
                              }
                            }}
                          >
                            {project.sections.length
                              ? say('继续写作', 'Continue writing')
                              : say('编辑大纲', 'Edit outline')}
                          </Button>
                          {project.sections.length > 0 &&
                            project.sections.every((item) => item.accepted) && (
                              <Button
                                onClick={() => void publishResult()}
                                disabled={busy || outlineDirty || configDirty}
                              >
                                {project.resultId
                                  ? resultOutdated
                                    ? say('更新成果', 'Update result')
                                    : say('打开关联成果', 'Open linked result')
                                  : say('保存为成果', 'Save as result')}
                              </Button>
                            )}
                        </section>
                      ),
                    },
                  ]
                : []),
              {
                key: 'setup',
                label: embedded
                  ? stageLabel(
                      1,
                      say('目标与资料', 'Goal and sources'),
                      Boolean(project),
                      stage === 'setup'
                    )
                  : say('1. 目标与资料', '1. Goal and sources'),
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
                label: embedded
                  ? stageLabel(
                      2,
                      say('大纲', 'Outline'),
                      Boolean(project?.outlineConfirmed),
                      stage === 'outline'
                    )
                  : say('2. 确认大纲', '2. Outline'),
                disabled: !project,
                children: (
                  <Card>
                    <div className={styles.modelLine}>
                      <Tag>
                        {say('使用', 'Using')} {model?.model ?? say('当前模型', 'current model')}
                      </Tag>
                      {professional && (
                        <details>
                          <summary>{say('更换模型', 'Change model')}</summary>
                          <Select
                            aria-label={say('写作模型服务', 'Writing provider')}
                            value={providerId}
                            options={providers.map((item) => ({
                              value: item.id,
                              label: `${item.id} · ${item.model}`,
                            }))}
                            onChange={setProviderId}
                            disabled={locked}
                            style={{ minWidth: 260 }}
                          />
                        </details>
                      )}
                    </div>
                    {!modelConfigured && (
                      <Alert
                        className={styles.modelNotice}
                        type="warning"
                        title={say('当前模型不可用', 'Current model unavailable')}
                        action={
                          <Button size="small" onClick={onOpenSettings}>
                            {say('去设置', 'Open settings')}
                          </Button>
                        }
                      />
                    )}
                    <Space wrap className={styles.outlineActions}>
                      <Button
                        disabled={locked || configDirty || !modelConfigured}
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
                      <div
                        className={styles.outlineRow}
                        key={row.id ?? index}
                        data-dragging={draggedRow === index}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedRow !== null) moveRow(draggedRow, index);
                          setDraggedRow(null);
                        }}
                      >
                        <button
                          type="button"
                          className={styles.dragHandle}
                          draggable={!locked}
                          title={say(
                            '拖动排序；Alt 加方向键也可移动',
                            'Drag to reorder; Alt and arrow keys also move'
                          )}
                          aria-label={`${say('调整章节顺序', 'Reorder section')} ${index + 1}`}
                          onDragStart={() => setDraggedRow(index)}
                          onDragEnd={() => setDraggedRow(null)}
                          onKeyDown={(event) => {
                            if (!event.altKey) return;
                            if (event.key === 'ArrowUp') {
                              event.preventDefault();
                              moveRow(index, index - 1);
                            }
                            if (event.key === 'ArrowDown') {
                              event.preventDefault();
                              moveRow(index, index + 1);
                            }
                          }}
                        >
                          <HolderOutlined />
                        </button>
                        <div>
                          <div className={styles.outlineRowMeta}>
                            <strong>{String(index + 1).padStart(2, '0')}</strong>
                            <Tag>
                              {project?.sections.find((item) => item.id === row.id)?.accepted
                                ? say('已接受', 'Accepted')
                                : project?.sections.find((item) => item.id === row.id)?.content
                                  ? say('草稿', 'Draft')
                                  : say('未开始', 'Not started')}
                            </Tag>
                          </div>
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
                          <span className={styles.fieldLabel}>
                            {say('目标字数', 'Target words')}
                          </span>
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
                        </Space>
                      </div>
                    ))}
                    <Space wrap>
                      <Button
                        type="text"
                        icon={<PlusOutlined />}
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
                        type="text"
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
                label: embedded
                  ? stageLabel(
                      3,
                      say('正文与审稿', 'Draft and review'),
                      Boolean(
                        project?.sections.length && project.sections.every((item) => item.accepted)
                      ),
                      stage === 'sections'
                    )
                  : say('3. 章节与成果', '3. Sections and result'),
                disabled: !project?.sections.length,
                children: (
                  <Card>
                    <div className={styles.modelLine}>
                      <Tag>
                        {say('使用', 'Using')} {model?.model ?? say('当前模型', 'current model')}
                      </Tag>
                      {professional && (
                        <details>
                          <summary>{say('更换模型', 'Change model')}</summary>
                          <Select
                            aria-label={say('章节写作服务', 'Section provider')}
                            value={providerId}
                            options={providers.map((item) => ({
                              value: item.id,
                              label: `${item.id} · ${item.model}`,
                            }))}
                            onChange={setProviderId}
                            disabled={locked}
                          />
                        </details>
                      )}
                    </div>
                    {!modelConfigured && (
                      <Alert
                        className={styles.modelNotice}
                        type="warning"
                        title={say('当前模型不可用', 'Current model unavailable')}
                        action={
                          <Button size="small" onClick={onOpenSettings}>
                            {say('去设置', 'Open settings')}
                          </Button>
                        }
                      />
                    )}
                    <Space wrap>
                      <Select
                        aria-label={say('当前章节', 'Current section')}
                        value={section?.id}
                        options={project?.sections.map((s, i) => ({
                          value: s.id,
                          label: `${i + 1}. ${s.title} · ${s.accepted ? say('已接受', 'Accepted') : say('待审阅', 'Pending')}`,
                        }))}
                        onChange={(value) => {
                          if (chapterId) openChapter(value);
                          else setSectionId(value);
                          setRunId('');
                        }}
                        style={{ minWidth: 260 }}
                        disabled={busy}
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
                              locked ||
                              configDirty ||
                              outlineDirty ||
                              !project?.outlineConfirmed ||
                              !modelConfigured
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
                          onClick={() => void publishResult()}
                        >
                          {project.resultId
                            ? resultOutdated
                              ? say('更新成果', 'Update result')
                              : say('打开关联成果', 'Open linked result')
                            : embedded
                              ? say('保存为成果', 'Save as result')
                              : say('合成为最终成果', 'Assemble final result')}
                        </Button>
                      </div>
                    )}
                  </Card>
                ),
              },
            ].filter((item) => !chapterId || item.key === 'sections')}
          />
          </WorkItemNavigation>
        </div>
      </div>
      <Modal
        open={!!plan}
        title={say('确认本次 AI 使用范围', 'Confirm AI scope')}
        onCancel={() => {
          if (plan) void api.cancel(plan.id);
          pendingPlan.current = null;
          epoch.current++;
          setPlan(null);
          setPlanSectionId(null);
        }}
        footer={null}
        width={640}
      >
        {plan && (
          <>
            <WritingSendSummary
              plan={plan}
              project={project}
              section={project?.sections.find((item) => item.id === planSectionId)}
              professional={professional}
            />
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
