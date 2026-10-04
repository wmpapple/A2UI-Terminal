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
import { Alert, Button, ConfigProvider, Dropdown, Empty, message, Modal, Tag, theme } from 'antd';
import { useEffect, useRef, useState, type ReactNode } from 'react';

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
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [resourceView, setResourceView] = useState<'files' | 'tools'>('files');
  const [activeWorkItemType, setActiveWorkItemType] = useState<'document' | 'tool' | 'result'>(
    'document'
  );
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [openedToolIds, setOpenedToolIds] = useState<string[]>([]);
  const toolEntries = useSceneToolStore((state) => state.entries);
  const files = useAppStore((state) => state.files);
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
    const syncRoute = () => setRoute(routeFromHash(window.location.hash));
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
      : activeWorkItemType === 'result'
        ? activeResultId
        : activePath;

  const openResult = (resultId: string) => {
    startPerformanceMeasurement('requestFeedback');
    startPerformanceMeasurement('resultOpen');
    openWorkbench(resultId);
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
        else if (item.type === 'result') openResult(item.id);
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

  const content =
    route === 'home' ? (
      <HomePage onOpenWorkbench={openWorkbench} onOpenGuide={() => setOnboardingOpen(true)} />
    ) : route === 'projects' ? (
      <WritingProjectsPage onOpenResult={openResult} />
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
                {(['files', 'tools'] as const).map((tab) => (
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
                      : locale === 'zh-CN'
                        ? '我的工具'
                        : 'My Tools'}
                  </Button>
                ))}
              </div>
              <div className={styles.resourceContent}>
                {resourceView === 'tools' ? (
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
                    onBeforeOpenFile={confirmWorkspaceFileOpen}
                    onActivateWorkspace={() => setActiveWorkItemType('document')}
                  />
                )}
              </div>
            </div>
          }
          center={
            activeWorkItemType === 'tool' ? (
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
            ) : (
              <EditorPane
                workItemTabs={workItemTabs}
                leftPanelLabels={leftPanelLabels}
                showInspector={professional}
                showSimpleFileActions={!professional}
                onOpenResult={openResult}
                onOpenTool={openTool}
              />
            )
          }
          right={
            activeWorkItemType === 'result' && activeResultId ? (
              <ResultAssistantPanel
                key={`assistant:${activeResultId}`}
                resultId={activeResultId}
                onOpenResult={openResult}
              />
            ) : (
              <ChatPanel
                key={activeWorkItemType === 'tool' ? `tool:${activeToolId ?? 'empty'}` : 'file'}
                professionalTools={professional}
                toolId={activeWorkItemType === 'tool' ? activeToolId : undefined}
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
        {professional && settingsOpen && (
          <ProviderSettings
            open={professional && settingsOpen}
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
