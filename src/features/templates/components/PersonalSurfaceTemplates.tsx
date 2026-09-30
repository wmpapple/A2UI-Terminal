import { DeleteOutlined, PlayCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Popconfirm, Spin, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { A2uiTemplate } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { a2uiController } from '../../a2ui/a2uiController';
import { EmptyIllustration } from '../../../shared/components/EmptyIllustration';
import styles from './PersonalSurfaceTemplates.module.css';
import { SceneTemplateCards } from '../../sceneTools/SceneTemplateCards';
import { SavedSceneTemplates } from '../../sceneTools/SavedSceneTemplates';
import { useResultStore } from '../../results/resultStore';
import type { ToolBinding } from '../../../shared/types/sceneTool';

interface Props {
  onOpened: () => void;
  onOpenMyTools: () => void;
  currentResultId?: string | null;
  onOpenResult?: (id: string) => void;
}

export function PersonalSurfaceTemplates({
  onOpened,
  onOpenMyTools,
  currentResultId,
  onOpenResult,
}: Props) {
  const { t, locale } = useI18n();
  const workspace = useAppStore((state) => state.workspace);
  const runtimeMode = useAppStore((state) => state.runtimeMode);
  const openTemplate = useAppStore((state) => state.openA2uiTemplate);
  const file = useAppStore((state) => state.files.find((f) => f.path === state.activePath));
  const currentResult = useResultStore((s) =>
    s.activeDocument?.result.id === currentResultId ? s.activeDocument : null
  );
  const sourceId = file?.documentId ?? file?.sourceId;
  const currentBinding: ToolBinding | undefined = currentResultId
    ? currentResult?.result.type === 'document'
      ? { type: 'document', target: { kind: 'result', resultId: currentResultId } }
      : undefined
    : workspace && sourceId && file && ['markdown', 'text', 'plaintext'].includes(file.language)
      ? {
          type: 'document',
          target: { kind: 'workspace_file', workspaceId: workspace.id, sourceId },
        }
      : undefined;
  const [result, setResult] = useState<{
    workspaceId: string;
    templates: A2uiTemplate[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!workspace || runtimeMode === 'web-mock') return;
    let active = true;
    const workspaceId = workspace.id;
    void a2uiController
      .listTemplates(workspaceId)
      .then((items) => {
        if (active) {
          setResult({ workspaceId, templates: items, error: null });
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setResult({
          workspaceId,
          templates: [],
          error:
            typeof reason === 'object' && reason && 'message' in reason
              ? String((reason as { message: unknown }).message)
              : t('templateListFailed'),
        });
      });
    return () => {
      active = false;
    };
  }, [runtimeMode, t, workspace]);

  const currentTemplates =
    runtimeMode === 'desktop' && workspace && result?.workspaceId === workspace.id ? result : null;
  const templates = currentTemplates?.templates ?? [];
  const error = currentTemplates?.error ?? null;
  const loading = runtimeMode === 'desktop' && Boolean(workspace) && currentTemplates === null;

  return (
    <main className={styles.page} aria-labelledby="templates-page-title">
      <div className={styles.content}>
        <header className={styles.heading}>
          <div className={styles.icon}>
            <SafetyCertificateOutlined />
          </div>
          <div>
            <h1 id="templates-page-title">{t('templatesPageTitle')}</h1>
            <p>{t('personalTemplatesDescription')}</p>
          </div>
        </header>
        {onOpenResult ? (
          <>
            <SceneTemplateCards onOpenResult={onOpenResult} currentBinding={currentBinding} />
          </>
        ) : null}
        <section aria-label={locale === 'zh-CN' ? '我的模板' : 'My Templates'}>
          <h2>{locale === 'zh-CN' ? '我的模板' : 'My Templates'}</h2>
          {onOpenResult ? (
            <SavedSceneTemplates onOpenResult={onOpenResult} onOpenMyTools={onOpenMyTools} />
          ) : null}
          {error ? <Alert type="error" showIcon title={error} /> : null}
          {loading ? (
            <Spin />
          ) : templates.length ? (
            <section
              aria-label={locale === 'zh-CN' ? '其他交互模板' : 'Other interaction templates'}
            >
              <h3>{locale === 'zh-CN' ? '其他交互模板' : 'Other interaction templates'}</h3>
              <div className={styles.grid}>
                {templates.map((template) => (
                  <Card
                    key={template.id}
                    title={template.name}
                    extra={
                      <Tag color={template.valid ? 'green' : 'red'}>
                        {t(template.valid ? 'templateValid' : 'templateInvalid')}
                      </Tag>
                    }
                    actions={[
                      <Button
                        key="open"
                        type="link"
                        icon={<PlayCircleOutlined />}
                        disabled={!template.valid}
                        onClick={() => {
                          void openTemplate(template.id).then((opened) => {
                            if (opened) onOpened();
                          });
                        }}
                      >
                        {t('openTemplate')}
                      </Button>,
                      <Popconfirm
                        key="delete"
                        title={t('deleteTemplateTitle')}
                        description={t('deleteTemplateDescription')}
                        okText={t('deletePermanently')}
                        cancelText={t('cancel')}
                        okButtonProps={{ danger: true }}
                        onConfirm={async () => {
                          if (!workspace) return;
                          try {
                            const deleted = await a2uiController.deleteTemplate(
                              workspace.id,
                              template.id
                            );
                            if (deleted)
                              setResult((current) =>
                                current?.workspaceId === workspace.id
                                  ? {
                                      ...current,
                                      templates: current.templates.filter(
                                        (item) => item.id !== template.id
                                      ),
                                    }
                                  : current
                              );
                          } catch (reason: unknown) {
                            setResult((current) => ({
                              workspaceId: workspace.id,
                              templates:
                                current?.workspaceId === workspace.id ? current.templates : [],
                              error:
                                typeof reason === 'object' && reason && 'message' in reason
                                  ? String((reason as { message: unknown }).message)
                                  : t('templateDeleteFailed'),
                            }));
                          }
                        }}
                      >
                        <Button type="link" danger icon={<DeleteOutlined />}>
                          {t('deletePermanently')}
                        </Button>
                      </Popconfirm>,
                    ]}
                  >
                    {template.valid ? (
                      <div className={styles.permissions}>
                        <strong>{t('templatePermissions')}</strong>
                        {template.permissions.length ? (
                          template.permissions.map((permission) => (
                            <div key={permission.actionType}>
                              <span>{permission.description}</span>
                            </div>
                          ))
                        ) : (
                          <span>{t('templateNoActions')}</span>
                        )}
                      </div>
                    ) : (
                      <Alert
                        type="warning"
                        showIcon
                        title={template.invalidReason ?? t('templateInvalid')}
                      />
                    )}
                  </Card>
                ))}
              </div>
            </section>
          ) : !onOpenResult ? (
            <Empty
              className={styles.empty}
              image={<EmptyIllustration />}
              styles={{ image: { height: 140 } }}
              description={t(
                runtimeMode === 'web-mock'
                  ? 'templateDesktopOnly'
                  : workspace
                    ? 'templatesPageEmpty'
                    : 'templateWorkspaceRequired'
              )}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}
