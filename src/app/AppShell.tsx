import {
  AppstoreOutlined,
  FileDoneOutlined,
  GlobalOutlined,
  DownOutlined,
  SearchOutlined,
  HomeOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  ConfigProvider,
  Dropdown,
  Empty,
  message,
  Modal,
  Select,
  Tag,
  theme,
} from 'antd';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { HomePage } from '../features/home/components/HomePage';
import { ImportBatchModal } from '../features/imports/components/ImportBatchModal';
import { useImportStore } from '../features/imports/importStore';
import { OnboardingDialog } from '../features/home/components/OnboardingDialog';
import { scheduleAutomaticUpdateCheck } from '../features/settings/appUpdater';

import { getRuntimeMode } from '../shared/platform/runtime';
import {
  finishPerformanceMeasurement,
  startPerformanceMeasurement,
} from '../shared/performance/performanceBudget';
import type { ResultAppliedReview } from '../shared/types/domain';
import { useAppStore } from '../stores/useAppStore';
import { useI18n } from './i18n/useI18n';
import styles from './AppShell.module.css';

import { ShellPage } from './ShellPage';
import { readOnboardingComplete, writeOnboardingComplete } from './onboardingPreferences';
import {
  navigateTo,
  readExperienceMode,
  routeFromHash,
  writeExperienceMode,
  type AppRoute,
  type ExperienceMode,
} from './shellPreferences';
import { useReducedMotion, useSystemTheme } from './useSystemTheme';
import { WorkspaceLayout } from './WorkspaceLayout';
import { WorkItemTabs } from './WorkItemTabs';
import { WorkspacePanelControls } from './WorkspacePanelControls';
import { sceneTools, useSceneToolStore } from '../features/sceneTools/sceneToolStore';
import { useResultStore } from '../features/results/resultStore';
import type { WorkItem } from '../shared/types/workItem';
import type { WritingProject } from '../shared/types/writingProject';
import { ProjectSidebar } from '../features/writingProjects/ProjectSidebar';
import type { CanvasBinding, CanvasDocument } from '../shared/types/canvas';
import { canvasRepository } from '../features/canvas/canvasRepository';
import { WorkbenchAppearance } from './WorkbenchAppearance';

import { lazyFeature } from './lazyFeature';
const KnowledgePage = lazyFeature(async () => {
  const module = await import('../features/knowledge/KnowledgePage');
  return { default: module.KnowledgePage };
});
const WritingProjectsPage = lazyFeature(async () => {
  const module = await import('../features/writingProjects/WritingProjectsPage');
  return { default: module.WritingProjectsPage };
});
const CommandPalette = lazyFeature(async () => {
  const module = await import('./CommandPalette');
  return { default: module.CommandPalette };
});
const CreateTextResultModal = lazyFeature(async () => {
  const module = await import('../features/results/components/CreateTextResultModal');
  return { default: module.CreateTextResultModal };
});
const ChatPanel = lazyFeature(async () => {
  const module = await import('../features/chat/components/ChatPanel');
  return { default: module.ChatPanel };
});
const ProviderSettings = lazyFeature(async () => {
  const module = await import('../features/settings/components/ProviderSettings');
  return { default: module.ProviderSettings };
});
const ResultsPage = lazyFeature(async () => {
  const module = await import('../features/results/components/ResultsPage');
  return { default: module.ResultsPage };
});
const PersonalSurfaceTemplates = lazyFeature(async () => {
  const module = await import('../features/templates/components/PersonalSurfaceTemplates');
  return { default: module.PersonalSurfaceTemplates };
});
const ResultAssistantPanel = lazyFeature(async () => {
  const module = await import('../features/results/components/ResultAssistantPanel');
  return { default: module.ResultAssistantPanel };
});
const ResultWorkbench = lazyFeature(async () => {
  const module = await import('../features/results/components/ResultWorkbench');
  return { default: module.ResultWorkbench };
});
const MySceneTools = lazyFeature(async () => {
  const module = await import('../features/sceneTools/MySceneTools');
  return { default: module.MySceneTools };
});
const SceneToolWorkbench = lazyFeature(async () => {
  const module = await import('../features/sceneTools/SceneToolWorkbench');
  return { default: module.SceneToolWorkbench };
});
const EditorPane = lazyFeature(async () => {
  const module = await import('../features/workspace/components/EditorPane');
  return { default: module.EditorPane };
});
const WorkspaceSidebar = lazyFeature(async () => {
  const module = await import('../features/workspace/components/WorkspaceSidebar');
  return { default: module.WorkspaceSidebar };
});
const CanvasSidebar = lazyFeature(async () => {
  const module = await import('../features/canvas/CanvasSidebar');
  return { default: module.CanvasSidebar };
});
const CanvasPage = lazyFeature(async () => {
  const module = await import('../features/canvas/CanvasPage');
  return { default: module.CanvasPage };
});
const SettingsPage = lazyFeature(async () => {
  const module = await import('./SettingsPage');
  return { default: module.SettingsPage };
});

export function AppShell() {
  const dark = useSystemTheme();
  const reducedMotion = useReducedMotion();
  const { locale, setLocale, t } = useI18n();
  const mode = getRuntimeMode();
  const initializeWorkspace = useAppStore((state) => state.initializeWorkspace);
  const initializeProviders = useAppStore((state) => state.initializeProviders);
  const patchApplying = useAppStore((state) => state.patchApplying);
  const patchError = useAppStore((state) => state.patchError);
  const undoLastPatch = useAppStore((state) => state.undoLastPatch);
  const acceptImportedSelection = useAppStore((state) => state.acceptImportedSelection);
  const importError = useImportStore((state) => state.error);
  const clearImportError = useImportStore((state) => state.clearError);
  const [commandOpen, setCommandOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => !readOnboardingComplete());
  const [experienceMode, setExperienceMode] = useState(readExperienceMode);
  const [route, setRoute] = useState(() =>
    routeFromHash(window.location.hash) === 'projects'
      ? 'workbench'
      : routeFromHash(window.location.hash)
  );
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [resourceView, setResourceView] = useState<'files' | 'tools' | 'projects' | 'canvas'>(() =>
    routeFromHash(window.location.hash) === 'projects' ? 'projects' : 'files'
  );
  const [activeWorkItemType, setActiveWorkItemType] = useState<
    'document' | 'tool' | 'project' | 'project-section' | 'result' | 'canvas'
  >(routeFromHash(window.location.hash) === 'projects' ? 'project' : 'document');
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [openedToolIds, setOpenedToolIds] = useState<string[]>([]);
  const [canvases, setCanvases] = useState<CanvasDocument[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const [openedCanvasIds, setOpenedCanvasIds] = useState<string[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [openedProjectIds, setOpenedProjectIds] = useState<string[]>([]);
  const [openedSections, setOpenedSections] = useState<
    Array<{ projectId: string; sectionId: string }>
  >([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(
    () => routeFromHash(window.location.hash) === 'projects'
  );
  const [projectItems, setProjectItems] = useState<WritingProject[]>([]);
  const [projectRefresh, setProjectRefresh] = useState(0);
  const [projectInitialTab, setProjectInitialTab] = useState('overview');
  const [dirtyProjectIds, setDirtyProjectIds] = useState<string[]>([]);
  const onActiveProjectDirty = useCallback(
    (dirty: boolean) => {
      const id = activeProjectId ?? 'new-project';
      setDirtyProjectIds((current) => {
        if (dirty && !current.includes(id)) return [...current, id];
        if (!dirty && current.includes(id)) return current.filter((item) => item !== id);
        return current;
      });
    },
    [activeProjectId]
  );
  const toolEntries = useSceneToolStore((state) => state.entries);
  const files = useAppStore((state) => state.files);
  const workspace = useAppStore((state) => state.workspace);
  const workspaceEntries = useAppStore((state) => state.workspaceEntries);
  const runtimeMode = useAppStore((state) => state.runtimeMode);
  const canvasWorkspaceId = workspace?.id ?? (runtimeMode === 'web-mock' ? 'web-mock' : null);
  const visibleCanvases = canvases.filter(
    (canvas) =>
      canvasWorkspaceId && (canvas.workspaceId === canvasWorkspaceId || canvas.workspaceId === null)
  );
  const projectWorkspaceId =
    workspace?.id ?? (runtimeMode === 'web-mock' ? 'web-mock-workspace' : null);
  const openPaths = useAppStore((state) => state.openPaths);
  const activePath = useAppStore((state) => state.activePath);
  const dirtyPaths = useAppStore((state) => state.dirtyPaths);
  const openFile = useAppStore((state) => state.openFile);
  const closeFile = useAppStore((state) => state.closeFile);
  const resultDocument = useResultStore((state) => state.activeDocument);
  const resultSaveStatus = useResultStore((state) => state.saveStatus);
  const [pendingToolAction, setPendingToolAction] = useState<{
    id: string;
    action: 'rename' | 'binding' | 'template';
  } | null>(null);
  const [messageApi, messageContextHolder] = message.useMessage();
  const [modalApi, modalContextHolder] = Modal.useModal();
  const mainContentRef = useRef<HTMLDivElement>(null);
  const initialRouteRef = useRef(true);
  const professional = experienceMode === 'professional';
  const leftPanelLabels: [string, string] | undefined =
    resourceView === 'tools'
      ? locale === 'zh-CN'
        ? ['收起工具栏', '展开工具栏']
        : ['Collapse tools panel', 'Expand tools panel']
      : undefined;

  useEffect(() => {
    void initializeWorkspace();
    void initializeProviders();
  }, [initializeProviders, initializeWorkspace]);

  useEffect(() => scheduleAutomaticUpdateCheck(), []);
  useEffect(() => {
    if (!canvasWorkspaceId) return;
    let active = true;
    void canvasRepository
      .list(canvasWorkspaceId)
      .then((items) => {
        if (active) setCanvases(items);
      })
      .catch((error) => {
        if (active) void messageApi.error(String(error));
      });
    return () => {
      active = false;
    };
  }, [canvasWorkspaceId, messageApi]);
  useEffect(() => {
    if (!projectWorkspaceId || (route !== 'workbench' && route !== 'home')) return;
    let current = true;
    void import('../features/writingProjects/writingProjectController').then(
      ({ writingProjectController }) =>
        writingProjectController
          .list(projectWorkspaceId)
          .then((items) => {
            if (current) setProjectItems(items);
          })
          .catch(() => {
            if (current) setProjectItems([]);
          })
    );
    return () => {
      current = false;
    };
  }, [projectWorkspaceId, projectRefresh, route]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'k'
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setCommandOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      const next = routeFromHash(window.location.hash);
      if (next === 'projects') {
        setResourceView('projects');
        setActiveWorkItemType('project');
        setCreatingProject(true);
        setRoute('workbench');
        navigateTo('workbench');
      } else setRoute(next);
    };
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  useEffect(() => {
    if (initialRouteRef.current) {
      initialRouteRef.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      mainContentRef.current?.focus({ preventScroll: true });
      finishPerformanceMeasurement('requestFeedback');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeResultId, route]);

  const changeExperienceMode = (nextMode: ExperienceMode) => {
    writeExperienceMode(nextMode);
    setExperienceMode(nextMode);
    if (nextMode === 'simple') setSettingsOpen(false);
  };

  const openRoute = (nextRoute: AppRoute) => {
    setRoute(nextRoute);
    navigateTo(nextRoute);
  };

  const openWorkbench = (resultId?: string) => {
    if (resultId) setActiveResultId(resultId);
    setActiveWorkItemType(resultId ? 'result' : 'document');
    openRoute('workbench');
  };

  const openTool = (id: string) => {
    setActiveToolId(id);
    setOpenedToolIds((current) => (current.includes(id) ? current : [...current, id]));
    setActiveWorkItemType('tool');
    openRoute('workbench');
  };

  const openCanvas = (id: string) => {
    setActiveCanvasId(id);
    setOpenedCanvasIds((current) => (current.includes(id) ? current : [...current, id]));
    setActiveWorkItemType('canvas');
    openRoute('workbench');
  };
  const createCanvas = async (title: string, binding: CanvasBinding) => {
    if (!canvasWorkspaceId) throw new Error('请先打开工作区');
    const prepared: CanvasBinding =
      binding.type === 'folder'
        ? {
            ...binding,
            snapshot: workspaceEntries
              .filter((entry) => entry.path.startsWith(`${binding.path}/`))
              .map((entry) => entry.path)
              .sort(),
          }
        : binding;
    const created = await canvasRepository.create(canvasWorkspaceId, title, prepared);
    setCanvases((current) => [created, ...current]);
    openCanvas(created.id);
  };
  const openAssociatedCanvas = async (binding: CanvasBinding) => {
    if (!canvasWorkspaceId) {
      void messageApi.warning('请先打开工作区');
      return;
    }
    const current = await canvasRepository.list(canvasWorkspaceId);
    setCanvases(current);
    const matches = current.filter(
      (item) =>
        item.binding.type === binding.type &&
        (binding.type === 'file' || binding.type === 'folder'
          ? 'path' in item.binding && item.binding.path === binding.path
          : binding.type === 'result'
            ? item.binding.type === 'result' && item.binding.resultId === binding.resultId
            : true)
    );
    if (matches.length > 1) {
      let chosen = matches[0].id;
      const accepted = await modalApi.confirm({
        title: '打开关联画布',
        content: (
          <Select
            defaultValue={chosen}
            style={{ width: '100%' }}
            options={matches.map((item) => ({ value: item.id, label: item.title }))}
            onChange={(value) => {
              chosen = value;
            }}
          />
        ),
        okText: '打开',
        cancelText: '取消',
      });
      if (accepted) openCanvas(chosen);
      return;
    }
    if (matches.length === 1) {
      openCanvas(matches[0].id);
      return;
    }
    const name =
      binding.type === 'file' || binding.type === 'folder'
        ? (binding.path.split('/').at(-1) ?? '文件')
        : '画布';
    await createCanvas(`${name} · 画布`, binding);
  };
  const deleteCanvas = async (id: string) => {
    if (!canvasWorkspaceId) return;
    await canvasRepository.delete(canvasWorkspaceId, id);
    setCanvases((items) => items.filter((item) => item.id !== id));
    setOpenedCanvasIds((items) => items.filter((item) => item !== id));
    if (activeCanvasId === id) {
      setActiveCanvasId(null);
      setActiveWorkItemType('document');
    }
  };

  const openProject = (id: string, browseProjects = false) => {
    if (browseProjects) setResourceView('projects');
    setProjectInitialTab('overview');
    setActiveProjectId(id);
    setOpenedProjectIds((current) => (current.includes(id) ? current : [...current, id]));
    setCreatingProject(false);
    setActiveWorkItemType('project');
    openRoute('workbench');
  };
  const openProjectSection = (projectId: string, sectionId: string) => {
    setActiveProjectId(projectId);
    setActiveSectionId(sectionId);
    setOpenedProjectIds((current) =>
      current.includes(projectId) ? current : [...current, projectId]
    );
    setOpenedSections((current) =>
      current.some((item) => item.projectId === projectId && item.sectionId === sectionId)
        ? current
        : [...current, { projectId, sectionId }]
    );
    setActiveWorkItemType('project-section');
    openRoute('workbench');
  };
  const startProject = () => {
    setProjectInitialTab('setup');
    setResourceView('projects');
    setActiveProjectId(null);
    setCreatingProject(true);
    setActiveWorkItemType('project');
    openRoute('workbench');
  };
  const closeProject = (id: string) => {
    setDirtyProjectIds((current) => current.filter((item) => item !== id));
    if (id === 'new-project') setCreatingProject(false);
    else setOpenedProjectIds((current) => current.filter((item) => item !== id));
    if (activeWorkItemType === 'project' && (activeProjectId ?? 'new-project') === id) {
      const nextProject = openedProjectIds.filter((item) => item !== id).at(-1) ?? null;
      setActiveProjectId(nextProject);
      setActiveWorkItemType(nextProject ? 'project' : activeResultId ? 'result' : 'document');
    }
  };
  const closeProjectSection = (projectId: string, sectionId: string) => {
    setOpenedSections((current) =>
      current.filter((item) => item.projectId !== projectId || item.sectionId !== sectionId)
    );
    if (
      activeWorkItemType === 'project-section' &&
      activeProjectId === projectId &&
      activeSectionId === sectionId
    ) {
      setActiveSectionId(null);
      setActiveWorkItemType('project');
    }
  };

  const closeTool = (id: string) => {
    setOpenedToolIds((current) => current.filter((item) => item !== id));
    if (activeToolId === id) {
      const nextTool = openedToolIds.filter((item) => item !== id).at(-1) ?? null;
      setActiveToolId(nextTool);
      if (!nextTool) setActiveWorkItemType(activeResultId ? 'result' : 'document');
    }
  };

  const toolItems: WorkItem[] = openedToolIds.map((id) => ({
    id,
    type: 'tool',
    title: toolEntries[id]?.view?.result.title ?? (locale === 'zh-CN' ? '工具' : 'Tool'),
    status: toolEntries[id]?.conflict ? 'conflict' : toolEntries[id]?.dirty ? 'dirty' : 'saved',
  }));
  const workItems: WorkItem[] = [
    ...openPaths.map((path): WorkItem => ({
      id: path,
      type: 'document',
      title: files.find((file) => file.path === path)?.name ?? path.split('/').at(-1) ?? path,
      status: dirtyPaths.includes(path) ? 'dirty' : 'saved',
    })),
    ...toolItems,
    ...openedCanvasIds
      .filter((id) => visibleCanvases.some((canvas) => canvas.id === id))
      .map((id): WorkItem => ({
        id,
        type: 'canvas',
        title: visibleCanvases.find((canvas) => canvas.id === id)?.title ?? '画布',
        status: 'saved',
      })),
    ...openedProjectIds.map((id): WorkItem => ({
      id,
      type: 'project',
      title:
        projectItems.find((project) => project.id === id)?.config.title ??
        (locale === 'zh-CN' ? '长文项目' : 'Project'),
      status: dirtyProjectIds.includes(id) ? 'dirty' : 'saved',
    })),
    ...openedSections.map(({ projectId, sectionId }): WorkItem => ({
      id: `${projectId}:${sectionId}`,
      type: 'project-section',
      title:
        projectItems
          .find((project) => project.id === projectId)
          ?.sections.find((section) => section.id === sectionId)?.title ??
        (locale === 'zh-CN' ? '项目章节' : 'Project section'),
      status: 'saved',
    })),
    ...(creatingProject
      ? [
          {
            id: 'new-project',
            type: 'project' as const,
            title: locale === 'zh-CN' ? '新建长文项目' : 'New writing project',
            status: dirtyProjectIds.includes('new-project')
              ? ('dirty' as const)
              : ('saved' as const),
          },
        ]
      : []),
    ...(activeResultId
      ? [
          {
            id: activeResultId,
            type: 'result' as const,
            title:
              resultDocument?.result.id === activeResultId
                ? resultDocument.result.title
                : locale === 'zh-CN'
                  ? '成果'
                  : 'Result',
            status: resultSaveStatus === 'dirty' ? ('dirty' as const) : ('saved' as const),
          },
        ]
      : []),
  ];
  const activeWorkItemId =
    activeWorkItemType === 'tool'
      ? activeToolId
      : activeWorkItemType === 'canvas'
        ? activeCanvasId
        : activeWorkItemType === 'project'
          ? (activeProjectId ?? (creatingProject ? 'new-project' : null))
          : activeWorkItemType === 'project-section' && activeProjectId && activeSectionId
            ? `${activeProjectId}:${activeSectionId}`
            : activeWorkItemType === 'result'
              ? activeResultId
              : activePath;

  const openResult = (resultId: string) => {
    startPerformanceMeasurement('requestFeedback');
    startPerformanceMeasurement('resultOpen');
    openWorkbench(resultId);
  };

  const openProjectResult = (resultId: string) => {
    const resultState = useResultStore.getState();
    if (resultState.activeDocument?.result.id === resultId && resultState.saveStatus === 'saved') {
      void resultState.openResult(resultId).then(() => openResult(resultId));
    } else openResult(resultId);
  };

  const confirmWorkspaceFileOpen = async (_path: string, name: string) => {
    if (activeWorkItemType !== 'result' || !activeResultId) return true;
    const { useResultStore } = await import('../features/results/resultStore');
    const resultState = useResultStore.getState();
    const hasUnsavedChanges = Boolean(
      resultState.activeDocument && resultState.draftContent !== resultState.activeDocument.content
    );
    const confirmed = await modalApi.confirm({
      title: t('openWorkspaceFileTitle'),
      content: t(
        hasUnsavedChanges ? 'openWorkspaceFileUnsavedDescription' : 'openWorkspaceFileDescription'
      ).replace('{name}', name),
      okText: t('openWorkspaceFileConfirm'),
      cancelText: t('stayWithResult'),
      centered: true,
    });
    if (!confirmed) return false;
    if (hasUnsavedChanges && resultState.saveStatus === 'dirty') {
      resultState.clearError();
      await resultState.persistDraft();
      const draftError = useResultStore.getState().error;
      if (draftError) {
        void messageApi.error(draftError);
        return false;
      }
    }
    return true;
  };

  const closeWorkItem = async (item: WorkItem) => {
    if (item.type === 'canvas') {
      setOpenedCanvasIds((items) => items.filter((id) => id !== item.id));
      if (activeCanvasId === item.id) {
        setActiveCanvasId(null);
        setActiveWorkItemType('document');
      }
      return;
    }
    if (item.type === 'project-section') {
      const section = openedSections.find(
        (entry) => `${entry.projectId}:${entry.sectionId}` === item.id
      );
      if (section) closeProjectSection(section.projectId, section.sectionId);
      return;
    }
    if (item.type === 'project') {
      if (dirtyProjectIds.includes(item.id)) {
        const confirmed = await modalApi.confirm({
          title: locale === 'zh-CN' ? '关闭未保存的项目视图？' : 'Close unsaved project view?',
          content:
            locale === 'zh-CN'
              ? '未保存的目标或大纲不会写入项目。关闭标签不会删除项目。'
              : 'Unsaved goal or outline changes will not be saved. Closing the tab does not delete the project.',
          okText: locale === 'zh-CN' ? '关闭标签' : 'Close tab',
          cancelText: locale === 'zh-CN' ? '继续编辑' : 'Keep editing',
          centered: true,
        });
        if (!confirmed) return;
      }
      closeProject(item.id);
      return;
    }
    if (item.type === 'document') {
      closeFile(item.id);
      return;
    }
    if (item.type === 'tool') {
      const entry = useSceneToolStore.getState().entries[item.id];
      if (entry?.conflict) {
        void messageApi.error(
          locale === 'zh-CN' ? '请先解决工具保存冲突' : 'Resolve the tool save conflict first'
        );
        return;
      }
      if ((entry?.dirty || entry?.saving) && !(await sceneTools.save(item.id))) {
        void messageApi.error(
          useSceneToolStore.getState().entries[item.id]?.error ??
            (locale === 'zh-CN'
              ? '工具保存失败，标签仍保持打开'
              : 'Tool save failed; tab remains open')
        );
        return;
      }
      closeTool(item.id);
      return;
    }
    if (item.type === 'result') {
      const resultState = useResultStore.getState();
      if (resultState.saving || resultState.saveStatus === 'saving') {
        void messageApi.info(
          locale === 'zh-CN' ? '正在保存成果，请稍后关闭' : 'Result is saving; please wait'
        );
        return;
      }
      const hasChanges =
        resultState.activeDocument?.result.id === item.id &&
        resultState.draftContent !== resultState.activeDocument.content;
      if (
        hasChanges &&
        (resultState.saveStatus === 'conflict' || resultState.saveStatus === 'error')
      ) {
        void messageApi.error(
          locale === 'zh-CN' ? '请先解决成果保存问题' : 'Resolve the result save issue first'
        );
        return;
      }
      if (hasChanges && resultState.saveStatus === 'dirty') {
        const confirmed = await modalApi.confirm({
          title: locale === 'zh-CN' ? '保存并关闭成果？' : 'Save and close result?',
          content:
            locale === 'zh-CN' ? '当前成果有未保存的修改。' : 'This result has unsaved changes.',
          okText: locale === 'zh-CN' ? '保存并关闭' : 'Save and close',
          cancelText: t('cancel'),
          centered: true,
        });
        if (!confirmed) return;
        resultState.clearError();
        await resultState.persistDraft();
        if (useResultStore.getState().error) {
          void messageApi.error(useResultStore.getState().error);
          return;
        }
      }
      setActiveResultId(null);
      setActiveWorkItemType('document');
    }
  };

  const workItemTabs = (
    <WorkItemTabs
      items={workItems}
      activeId={activeWorkItemId}
      onSelect={(item) => {
        if (item.type === 'tool') openTool(item.id);
        else if (item.type === 'canvas') openCanvas(item.id);
        else if (item.type === 'project') {
          if (item.id === 'new-project') startProject();
          else openProject(item.id);
        } else if (item.type === 'project-section') {
          const section = openedSections.find(
            (entry) => `${entry.projectId}:${entry.sectionId}` === item.id
          );
          if (section) openProjectSection(section.projectId, section.sectionId);
        } else if (item.type === 'result') openResult(item.id);
        else if (item.type === 'document') {
          void confirmWorkspaceFileOpen(item.id, item.title).then((allowed) => {
            if (!allowed) return;
            openWorkbench();
            openFile(item.id);
          });
        }
      }}
      onClose={(item) => void closeWorkItem(item)}
    />
  );

  const undoCreatedResult = async (review: ResultAppliedReview) => {
    const undone = await undoLastPatch(review);
    if (!undone) {
      void messageApi.error(useAppStore.getState().patchError ?? t('undoReviewUnavailable'));
      return;
    }
    setActiveResultId(null);
    setActiveWorkItemType('document');
    openRoute('results');
    void messageApi.success(t('undoReviewSuccess'));
  };

  const navigationItems: Array<{
    route: AppRoute;
    label: ReturnType<typeof t>;
    icon: ReactNode;
  }> = [
    { route: 'home', label: t('homeNavigation'), icon: <HomeOutlined /> },
    { route: 'knowledge', label: t('knowledgeNavigation'), icon: <AppstoreOutlined /> },
    { route: 'results', label: t('resultsNavigation'), icon: <FileDoneOutlined /> },
    { route: 'templates', label: t('templatesNavigation'), icon: <AppstoreOutlined /> },
    { route: 'workbench', label: t('workbenchNavigation'), icon: <ToolOutlined /> },
    { route: 'settings', label: t('settings'), icon: <SettingOutlined /> },
  ];
  const emptyProjectBrowse =
    activeWorkItemType === 'document' && !activePath && resourceView === 'projects';

  const content =
    route === 'projects' ? (
      <div />
    ) : route === 'home' ? (
      <HomePage
        onOpenWorkbench={openWorkbench}
        onOpenGuide={() => setOnboardingOpen(true)}
        onStartProject={startProject}
        onOpenProject={(id) => openProject(id, true)}
        recentProject={projectItems[0] ?? null}
      />
    ) : route === 'knowledge' ? (
      <KnowledgePage />
    ) : route === 'results' ? (
      <ResultsPage onOpenResult={openResult} />
    ) : route === 'workbench' ? (
      <WorkbenchAppearance>
        <WorkspaceLayout
          collapsible={activeWorkItemType !== 'result'}
          showLeftPanel
          leftPanelLabel={
            resourceView === 'tools'
              ? locale === 'zh-CN'
                ? '调整工具栏宽度'
                : 'Resize tools panel'
              : undefined
          }
          left={
            <div className={styles.resourceSidebar}>
              <div
                className={styles.workbenchTabs}
                role="tablist"
                aria-label={locale === 'zh-CN' ? '左侧资源视图' : 'Sidebar resources'}
              >
                {(['files', 'tools', 'projects', 'canvas'] as const).map((tab) => (
                  <Button
                    key={tab}
                    role="tab"
                    aria-selected={resourceView === tab}
                    type={resourceView === tab ? 'primary' : 'text'}
                    onClick={() => setResourceView(tab)}
                  >
                    {tab === 'files'
                      ? locale === 'zh-CN'
                        ? '文件'
                        : 'Files'
                      : tab === 'tools'
                        ? locale === 'zh-CN'
                          ? '我的工具'
                          : 'My Tools'
                        : tab === 'projects'
                          ? locale === 'zh-CN'
                            ? '项目'
                            : 'Projects'
                          : locale === 'zh-CN'
                            ? '画布'
                            : 'Canvas'}
                  </Button>
                ))}
              </div>
              <div className={styles.resourceContent}>
                {resourceView === 'canvas' ? (
                  <CanvasSidebar
                    canvases={visibleCanvases}
                    activeId={activeWorkItemType === 'canvas' ? activeCanvasId : null}
                    filePaths={workspaceEntries.map((entry) => entry.path)}
                    onCreate={createCanvas}
                    onOpen={openCanvas}
                    onDelete={deleteCanvas}
                  />
                ) : resourceView === 'projects' ? (
                  <ProjectSidebar
                    projects={projectItems}
                    activeId={
                      activeWorkItemType === 'project' || activeWorkItemType === 'project-section'
                        ? activeProjectId
                        : null
                    }
                    onOpen={openProject}
                    onCreate={startProject}
                  />
                ) : resourceView === 'tools' ? (
                  <div className={styles.toolsSidebar}>
                    <MySceneTools
                      activeId={activeWorkItemType === 'tool' ? activeToolId : null}
                      onOpenResult={openTool}
                      onCreate={() => openRoute('templates')}
                      onManage={(id, action) => {
                        openTool(id);
                        setPendingToolAction({ id, action });
                      }}
                      onDeleted={(id) => {
                        closeTool(id);
                        if (pendingToolAction?.id === id) setPendingToolAction(null);
                      }}
                    />
                  </div>
                ) : (
                  <WorkspaceSidebar
                    highlightActiveFile={activeWorkItemType === 'document'}
                    currentResultTitle={
                      activeWorkItemType === 'result'
                        ? resultDocument?.result.id === activeResultId
                          ? resultDocument.result.title
                          : locale === 'zh-CN'
                            ? '成果'
                            : 'Result'
                        : undefined
                    }
                    onBeforeOpenFile={confirmWorkspaceFileOpen}
                    onActivateWorkspace={() => setActiveWorkItemType('document')}
                    onOpenCanvas={(path, kind) => void openAssociatedCanvas({ type: kind, path })}
                  />
                )}
              </div>
            </div>
          }
          center={
            activeWorkItemType === 'canvas' &&
            activeCanvasId &&
            canvasWorkspaceId &&
            visibleCanvases.some((canvas) => canvas.id === activeCanvasId) ? (
              <div className={styles.toolContent}>
                <div className={styles.workItemBar}>
                  {workItemTabs}
                  <WorkspacePanelControls leftLabels={leftPanelLabels} />
                </div>
                <CanvasPage
                  key={activeCanvasId}
                  workspaceId={canvasWorkspaceId}
                  canvasId={activeCanvasId}
                  onUpdated={(updated) =>
                    setCanvases((items) =>
                      items.map((item) => (item.id === updated.id ? updated : item))
                    )
                  }
                  onOpenFile={(path) => {
                    setActiveWorkItemType('document');
                    void openFile(path);
                  }}
                  onOpenResult={openResult}
                  onOpenTool={openTool}
                />
              </div>
            ) : activeWorkItemType === 'project' || activeWorkItemType === 'project-section' ? (
              <div className={styles.toolContent}>
                <div className={styles.workItemBar}>
                  {workItemTabs}
                  <WorkspacePanelControls leftLabels={leftPanelLabels} />
                </div>
                <WritingProjectsPage
                  key={`${activeProjectId ?? 'new-project'}:${activeWorkItemType === 'project-section' ? activeSectionId : 'project'}`}
                  embedded
                  projectId={activeProjectId}
                  chapterId={activeWorkItemType === 'project-section' ? activeSectionId : null}
                  initialTab={projectInitialTab}
                  professional={professional}
                  onOpenSection={(sectionId) =>
                    activeProjectId && openProjectSection(activeProjectId, sectionId)
                  }
                  onOpenProject={() => activeProjectId && openProject(activeProjectId)}
                  onOpenSettings={() => openRoute('settings')}
                  onProjectCreated={(id) => {
                    setDirtyProjectIds((current) =>
                      current.filter((item) => item !== 'new-project')
                    );
                    openProject(id);
                    setProjectInitialTab('outline');
                    setProjectRefresh((value) => value + 1);
                  }}
                  onProjectChanged={() => setProjectRefresh((value) => value + 1)}
                  onDirtyChange={onActiveProjectDirty}
                  onProjectDeleted={(id) => {
                    setOpenedSections((current) => current.filter((item) => item.projectId !== id));
                    closeProject(id);
                    setProjectRefresh((value) => value + 1);
                  }}
                  onOpenResult={openProjectResult}
                />
              </div>
            ) : activeWorkItemType === 'tool' ? (
              <div className={styles.toolContent}>
                <div className={styles.workItemBar}>
                  {workItemTabs}
                  <WorkspacePanelControls leftLabels={leftPanelLabels} />
                </div>
                {activeToolId ? (
                  <SceneToolWorkbench
                    key={activeToolId}
                    resultId={activeToolId}
                    onOpenResult={openResult}
                    professional={professional}
                    requestedAction={
                      pendingToolAction?.id === activeToolId ? pendingToolAction.action : null
                    }
                    onRequestedActionHandled={() => setPendingToolAction(null)}
                    onDeleted={(id) => {
                      closeTool(id);
                      if (pendingToolAction?.id === id) setPendingToolAction(null);
                    }}
                  />
                ) : (
                  <Empty
                    description={
                      locale === 'zh-CN'
                        ? '选择一个工具继续使用，或从模板创建。'
                        : 'Select a tool or create one from a template.'
                    }
                  />
                )}
              </div>
            ) : activeWorkItemType === 'result' && activeResultId ? (
              <div className={styles.toolContent}>
                {workItemTabs}
                <ResultWorkbench
                  key={activeResultId}
                  resultId={activeResultId}
                  onDuplicated={openResult}
                  onOpenTool={openTool}
                  onOpenResults={() => openRoute('results')}
                  reviewUndoing={patchApplying}
                  reviewUndoError={patchError}
                  onUndoReview={(review) => void undoCreatedResult(review)}
                />
              </div>
            ) : emptyProjectBrowse ? (
              <div className={styles.toolContent}>
                <div className={styles.workItemBar}>{workItemTabs}</div>
                <Empty
                  description={
                    locale === 'zh-CN'
                      ? '选择一个项目继续写作，或新建长文项目'
                      : 'Choose a project or start a writing project'
                  }
                >
                  <Button type="primary" onClick={startProject}>
                    {locale === 'zh-CN' ? '新建项目' : 'New project'}
                  </Button>
                </Empty>
              </div>
            ) : (
              <EditorPane
                workItemTabs={workItemTabs}
                leftPanelLabels={leftPanelLabels}
                showInspector={professional}
                showSimpleFileActions={!professional}
                onOpenResult={openResult}
                onOpenTool={openTool}
                onOpenCanvas={(path) => void openAssociatedCanvas({ type: 'file', path })}
              />
            )
          }
          right={
            activeWorkItemType === 'result' && activeResultId ? (
              <ResultAssistantPanel
                key={`assistant:${activeResultId}`}
                resultId={activeResultId}
                onOpenResult={openResult}
                onOpenSettings={() => openRoute('settings')}
              />
            ) : (activeWorkItemType === 'project' && !activeProjectId) || emptyProjectBrowse ? (
              <aside
                className={styles.projectSetupAssistant}
                aria-label={locale === 'zh-CN' ? '项目 AI 协作' : 'Project AI collaboration'}
              >
                <h2>{locale === 'zh-CN' ? 'AI 助手' : 'AI assistant'}</h2>
                <p>
                  {locale === 'zh-CN'
                    ? emptyProjectBrowse
                      ? '选择或新建项目后，AI 会跟随当前项目。'
                      : '先完成项目目标与资料设置，再启用 AI 协作。'
                    : emptyProjectBrowse
                      ? 'Choose or create a project to work with AI.'
                      : 'Finish project setup to enable AI collaboration.'}
                </p>
              </aside>
            ) : (
              <ChatPanel
                key={
                  activeWorkItemType === 'tool'
                    ? `tool:${activeToolId ?? 'empty'}`
                    : activeWorkItemType === 'project' || activeWorkItemType === 'project-section'
                      ? `project:${activeProjectId ?? 'new'}:${activeSectionId ?? 'overview'}`
                      : emptyProjectBrowse
                        ? 'project:empty'
                        : 'file'
                }
                professionalTools={professional}
                toolId={activeWorkItemType === 'tool' ? activeToolId : undefined}
                project={
                  activeWorkItemType === 'project' ||
                  activeWorkItemType === 'project-section' ||
                  emptyProjectBrowse
                    ? (projectItems.find((item) => item.id === activeProjectId) ?? null)
                    : undefined
                }
                projectSection={
                  activeWorkItemType === 'project-section'
                    ? (projectItems
                        .find((item) => item.id === activeProjectId)
                        ?.sections.find((section) => section.id === activeSectionId) ?? null)
                    : undefined
                }
              />
            )
          }
        />
      </WorkbenchAppearance>
    ) : route === 'templates' ? (
      <PersonalSurfaceTemplates
        onOpened={() => openWorkbench()}
        onOpenMyTools={() => {
          setResourceView('tools');
          openRoute('workbench');
        }}
        onOpenResult={openTool}
        currentResultId={activeResultId}
      />
    ) : route === 'settings' ? (
      <SettingsPage
        experienceMode={experienceMode}
        onExperienceModeChange={changeExperienceMode}
        onOpenProviderSettings={() => setSettingsOpen(true)}
      />
    ) : (
      <ShellPage route={route} onOpenWorkbench={() => openWorkbench()} />
    );

  const completeOnboarding = () => {
    writeOnboardingComplete();
    setOnboardingOpen(false);
    openRoute('home');
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          motion: !reducedMotion,
          colorPrimary: dark ? '#dba47e' : '#b94b19',
          colorBgLayout: dark ? '#0b0f19' : '#f8fafc',
          colorBgContainer: dark ? '#1e293b' : '#ffffff',
          colorText: dark ? '#e2e8f0' : '#0f172a',
          colorTextSecondary: dark ? '#a8b6cb' : '#64748b',
          colorTextLightSolid: dark ? '#0b0f19' : '#ffffff',
          borderRadius: 10,
          fontFamily: 'Inter, "Segoe UI", sans-serif',
        },
      }}
    >
      {messageContextHolder}
      {modalContextHolder}
      <div className={styles.app}>
        <a className={styles.skipLink} href="#main-content">
          {t('skipToMainContent')}
        </a>
        <ConfigProvider theme={{ token: { colorPrimary: dark ? '#dba47e' : '#b94b19' } }}>
          <header className={styles.titlebar} data-tauri-drag-region>
            <div className={styles.brand} data-tauri-drag-region>
              <span className={styles.logo}>A</span>
              <strong>{t('appName')}</strong>
              <Tag className={styles.versionTag}>V2.0</Tag>
            </div>
            <nav className={styles.navigation} aria-label={t('mainNavigation')}>
              {navigationItems.map((item) => (
                <Button
                  key={item.route}
                  type="text"
                  aria-label={item.label}
                  icon={item.icon}
                  aria-current={route === item.route ? 'page' : undefined}
                  onClick={() => openRoute(item.route)}
                >
                  {item.label}
                </Button>
              ))}
            </nav>
            <div className={styles.titleActions} role="group" aria-label={t('quickControls')}>
              <Button
                type="text"
                icon={<SearchOutlined />}
                aria-label={t('commandPalette')}
                title={t('commandPalette') + ' (Ctrl/Cmd+K)'}
                onClick={() => setCommandOpen(true)}
              />
              <Dropdown
                trigger={['click']}
                menu={{
                  selectedKeys: [experienceMode],
                  onClick: ({ key }) => changeExperienceMode(key as ExperienceMode),
                  items: [
                    { key: 'simple', label: t('simpleMode') },
                    { key: 'professional', label: t('professionalMode') },
                  ],
                }}
              >
                <Button
                  type="text"
                  aria-label={t('experienceModeTitle')}
                  icon={<DownOutlined />}
                  iconPlacement="end"
                >
                  {t(professional ? 'professionalMode' : 'simpleMode')}
                </Button>
              </Dropdown>
              {professional ? (
                <Tag color={mode === 'web-mock' ? 'blue' : 'green'}>
                  {mode === 'web-mock' ? t('mockMode') : 'Desktop'}
                </Tag>
              ) : null}
              <Dropdown
                trigger={['click']}
                menu={{
                  selectedKeys: [locale],
                  onClick: ({ key }) => setLocale(key as 'zh-CN' | 'en-US'),
                  items: [
                    { key: 'zh-CN', label: '简体中文' },
                    { key: 'en-US', label: 'English' },
                  ],
                }}
              >
                <Button type="text" icon={<GlobalOutlined />}>
                  {locale === 'zh-CN' ? '中文' : 'EN'}
                </Button>
              </Dropdown>
            </div>
          </header>
        </ConfigProvider>
        <div
          ref={mainContentRef}
          id="main-content"
          className={styles.mainContent}
          data-route={route}
          tabIndex={-1}
          aria-label={t('mainContent')}
        >
          {content}
        </div>
        {route === 'workbench' ? (
          <>
            {importError ? (
              <Alert
                type="error"
                showIcon
                closable
                title={importError}
                onClose={clearImportError}
              />
            ) : null}
            <ImportBatchModal onConfirmed={acceptImportedSelection} />
          </>
        ) : null}
        {settingsOpen && (
          <ProviderSettings
            open={settingsOpen}
            includeSystemSettings={false}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {commandOpen && (
          <CommandPalette
            onClose={() => setCommandOpen(false)}
            onCreate={() => setCreateOpen(true)}
            onOpenWorkbench={openWorkbench}
            onNavigate={openRoute}
          />
        )}
        {createOpen && (
          <CreateTextResultModal
            open
            onCancel={() => setCreateOpen(false)}
            onCreated={(id) => {
              setCreateOpen(false);
              openResult(id);
            }}
          />
        )}
        <OnboardingDialog
          open={onboardingOpen}
          onFinish={completeOnboarding}
          onSkip={completeOnboarding}
        />
      </div>
    </ConfigProvider>
  );
}
