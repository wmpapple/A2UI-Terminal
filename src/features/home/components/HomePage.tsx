import {
  AppstoreAddOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FormOutlined,
  MessageOutlined,
  RightOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Empty, Form, Input, Modal, Select, Skeleton, Tag } from 'antd';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { MessageKey } from '../../../app/i18n/messages';
import type { ResultStatus } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { useHomeStore } from '../homeStore';
import { SourceDropZone } from './SourceDropZone';
import { CreateTextResultModal } from '../../results/components/CreateTextResultModal';
import styles from './HomePage.module.css';

interface Props {
  onOpenWorkbench: (resultId?: string) => void;
  onOpenGuide: () => void;
}

type HomeAction = 'write' | 'modify' | 'organize' | 'analyze' | 'build' | 'free';

const actions: Array<{
  id: HomeAction;
  title: MessageKey;
  description: MessageKey;
  icon: ReactNode;
  templateIds: string[];
}> = [
  {
    id: 'write',
    title: 'homeActionWriteTitle',
    description: 'homeActionWriteDescription',
    icon: <FileTextOutlined />,
    templateIds: ['weekly_report'],
  },
  {
    id: 'modify',
    title: 'homeActionModifyTitle',
    description: 'homeActionModifyDescription',
    icon: <EditOutlined />,
    templateIds: ['resume_optimization'],
  },
  {
    id: 'organize',
    title: 'homeActionOrganizeTitle',
    description: 'homeActionOrganizeDescription',
    icon: <FolderOpenOutlined />,
    templateIds: ['meeting_minutes', 'document_summary'],
  },
  {
    id: 'analyze',
    title: 'homeActionAnalyzeTitle',
    description: 'homeActionAnalyzeDescription',
    icon: <BarChartOutlined />,
    templateIds: [],
  },
  {
    id: 'build',
    title: 'homeActionBuildTitle',
    description: 'homeActionBuildDescription',
    icon: <FormOutlined />,
    templateIds: [],
  },
  {
    id: 'free',
    title: 'homeActionFreeTitle',
    description: 'homeActionFreeDescription',
    icon: <MessageOutlined />,
    templateIds: [],
  },
];

const statusKeys: Record<ResultStatus, MessageKey> = {
  draft: 'resultStatusDraft',
  generating: 'resultStatusGenerating',
  review_pending: 'resultStatusReviewPending',
  ready: 'resultStatusReady',
  exporting: 'resultStatusExporting',
  failed: 'resultStatusFailed',
  archived: 'resultStatusArchived',
};

export function HomePage({ onOpenWorkbench, onOpenGuide }: Props) {
  const { locale, t } = useI18n();
  const workspace = useAppStore((state) => state.workspace);
  const runtimeMode = useAppStore((state) => state.runtimeMode);
  const templates = useHomeStore((state) => state.templates);
  const recentResults = useHomeStore((state) => state.recentResults);
  const activeTask = useHomeStore((state) => state.activeTask);
  const taskRunResult = useHomeStore((state) => state.taskRunResult);
  const initialized = useHomeStore((state) => state.initialized);
  const loading = useHomeStore((state) => state.loading);
  const taskLoading = useHomeStore((state) => state.taskLoading);
  const error = useHomeStore((state) => state.error);
  const initialize = useHomeStore((state) => state.initialize);
  const beginTask = useHomeStore((state) => state.beginTask);
  const createLocalScaffold = useHomeStore((state) => state.createLocalScaffold);
  const resetTask = useHomeStore((state) => state.resetTask);
  const clearError = useHomeStore((state) => state.clearError);
  const [taskAction, setTaskAction] = useState<HomeAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const workspaceId = workspace?.id ?? (runtimeMode === 'web-mock' ? 'web-mock-workspace' : null);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const actionTemplates = useMemo(() => {
    const ids = actions.find((item) => item.id === taskAction)?.templateIds ?? [];
    return templates.filter((template) => ids.includes(template.id));
  }, [taskAction, templates]);

  const openAction = (action: (typeof actions)[number]) => {
    setNotice(null);
    if (action.id === 'free') {
      onOpenWorkbench();
      return;
    }
    if (action.id === 'analyze' || action.id === 'build') {
      setNotice(t(action.id === 'analyze' ? 'homeAnalyzeNotReady' : 'homeBuildNotReady'));
      return;
    }
    resetTask();
    setTaskAction(action.id);
  };

  const closeTask = () => {
    setTaskAction(null);
    resetTask();
  };

  const formatUpdatedAt = (value: string) => {
    const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.valueOf())
      ? value
      : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };

  return (
    <main className={styles.page} aria-labelledby="home-page-title">
      <div className={styles.content}>
        <div className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>{t('homeEyebrow')}</span>
            <h1 id="home-page-title">{t('homeQuestion')}</h1>
            <p>{t('homeIntroduction')}</p>
          </div>
          <div>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              {t('createTextResult')}
            </Button>{' '}
            <Button onClick={onOpenGuide}>{t('replayOnboarding')}</Button>
          </div>
        </div>

        {error && taskAction === null ? (
          <Alert
            className={styles.notice}
            type="error"
            showIcon
            title={error}
            action={
              <Button size="small" onClick={() => void initialize()}>
                {t('retryHomeLoad')}
              </Button>
            }
            closable
            onClose={clearError}
          />
        ) : null}

        <section className={styles.section} aria-labelledby="home-actions-title">
          <div className={styles.sectionHeader}>
            <h2 id="home-actions-title">{t('homeActionsTitle')}</h2>
            <span>{t('homeActionsFixed')}</span>
          </div>
          <div className={styles.actionGrid}>
            {actions.map((action) => (
              <Card key={action.id} className={styles.actionCard} size="small">
                <Button
                  type="text"
                  className={styles.actionButton}
                  onClick={() => openAction(action)}
                >
                  <span className={styles.actionBody}>
                    <span className={styles.actionIcon}>{action.icon}</span>
                    <span className={styles.actionText}>
                      <strong>{t(action.title)}</strong>
                      <span>{t(action.description)}</span>
                    </span>
                  </span>
                </Button>
              </Card>
            ))}
          </div>
          {notice ? (
            <Alert
              className={styles.notice}
              type="info"
              showIcon
              closable
              title={notice}
              onClose={() => setNotice(null)}
            />
          ) : null}
        </section>

        <div className={styles.lowerGrid}>
          <section className={styles.section} aria-labelledby="home-sources-title">
            <div className={styles.sectionHeader}>
              <h2 id="home-sources-title">{t('homeSourcesSectionTitle')}</h2>
              <span>{t('homeSourcesSectionHint')}</span>
            </div>
            <SourceDropZone />
          </section>

          <section className={styles.section} aria-labelledby="recent-results-title">
            <div className={styles.sectionHeader}>
              <h2 id="recent-results-title">{t('recentResultsTitle')}</h2>
              <span>{t('recentResultsNotChats')}</span>
            </div>
            {loading && !initialized ? <Skeleton active paragraph={{ rows: 3 }} /> : null}
            {!loading && recentResults.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noRecentResults')} />
            ) : null}
            <div className={styles.results}>
              {recentResults.map((result) => (
                <article key={result.id} className={styles.resultItem}>
                  <div className={styles.resultMain}>
                    <span className={styles.resultTitle}>{result.title}</span>
                    <div className={styles.resultMeta}>
                      <Tag>{t('resultTypeDocument')}</Tag>
                      <Tag color={result.status === 'failed' ? 'red' : 'blue'}>
                        {t(statusKeys[result.status])}
                      </Tag>
                      <span>{formatUpdatedAt(result.updatedAt)}</span>
                    </div>
                  </div>
                  <Button
                    size="small"
                    icon={<RightOutlined />}
                    onClick={() => onOpenWorkbench(result.id)}
                  >
                    {t('continueResult')}
                  </Button>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={taskAction !== null}
        title={t('localTaskTitle')}
        width={700}
        footer={null}
        destroyOnHidden
        onCancel={closeTask}
      >
        <Alert type="info" showIcon title={t('localScaffoldDisclosure')} />
        {error ? (
          <Alert
            className={styles.notice}
            type="error"
            showIcon
            closable
            title={error}
            onClose={clearError}
          />
        ) : null}
        {!taskRunResult && !activeTask ? (
          <>
            {!workspaceId ? (
              <>
                <Alert
                  className={styles.notice}
                  type="warning"
                  showIcon
                  title={t('taskNeedsSources')}
                />
                <div className={styles.section}>
                  <SourceDropZone />
                </div>
              </>
            ) : null}
            <div className={styles.templateGrid} aria-label={t('chooseTemplate')}>
              {actionTemplates.map((template) => (
                <Button
                  key={template.id}
                  className={styles.templateButton}
                  disabled={!workspaceId}
                  loading={taskLoading}
                  onClick={() => workspaceId && void beginTask(workspaceId, template.id)}
                >
                  <strong>{template.name}</strong>
                  <span>{template.description}</span>
                </Button>
              ))}
            </div>
          </>
        ) : null}
        {activeTask && !taskRunResult ? (
          <Form
            key={activeTask.id}
            className={styles.taskForm}
            layout="vertical"
            initialValues={activeTask.inputAnswers}
            onFinish={(answers) => void createLocalScaffold(answers)}
          >
            {activeTask.questions.map((question) => (
              <Form.Item
                key={question.fieldId}
                name={question.fieldId}
                label={question.prompt}
                rules={[{ required: question.required, message: t('requiredAnswer') }]}
              >
                {question.kind === 'select' ? (
                  <Select options={question.options.map((value) => ({ value, label: value }))} />
                ) : (
                  <Input maxLength={question.maxLength ?? undefined} showCount />
                )}
              </Form.Item>
            ))}
            <Button type="primary" htmlType="submit" loading={taskLoading} block>
              {t('createLocalScaffold')}
            </Button>
          </Form>
        ) : null}
        {taskRunResult ? (
          <div className={styles.taskSuccess}>
            <CheckCircleFilled style={{ color: '#22a06b', fontSize: 36 }} />
            <h3>{t('localScaffoldCreated')}</h3>
            <p>{taskRunResult.result.title}</p>
            <p>{t('localScaffoldCreatedDescription')}</p>
            <Button
              type="primary"
              icon={<AppstoreAddOutlined />}
              onClick={() => onOpenWorkbench(taskRunResult.result.id)}
            >
              {t('continueInWorkbench')}
            </Button>
          </div>
        ) : null}
      </Modal>
      <CreateTextResultModal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onCreated={(resultId) => {
          setCreateOpen(false);
          onOpenWorkbench(resultId);
        }}
      />
    </main>
  );
}
