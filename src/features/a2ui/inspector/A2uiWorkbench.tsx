import { InfoNotice } from '../../../shared/components/InfoNotice';
import { EmptyIllustration } from '../../../shared/components/EmptyIllustration';
import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  SaveOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { Alert, Button, Empty, Input, Modal, Popconfirm, Select, Tabs, Tag } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { A2uiCapabilities } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { a2uiController } from '../a2uiController';
import { A2uiRuntime } from '../runtime/A2uiRuntime';
import styles from './A2uiWorkbench.module.css';

interface Props {
  showInspector?: boolean;
}

export function A2uiWorkbench({ showInspector = true }: Props) {
  const { t } = useI18n();
  const surfaces = useAppStore((state) => state.a2uiSurfaces);
  const inspections = useAppStore((state) => state.a2uiInspections);
  const runtimeMode = useAppStore((state) => state.runtimeMode);
  const activeSurfaceId = useAppStore((state) => state.activeSurfaceId);
  const activeInspectionId = useAppStore((state) => state.activeInspectionId);
  const actionLoading = useAppStore((state) => state.a2uiActionLoading);
  const notice = useAppStore((state) => state.a2uiNotice);
  const setActiveSurface = useAppStore((state) => state.setActiveSurface);
  const setActiveInspection = useAppStore((state) => state.setActiveInspection);
  const setCenterView = useAppStore((state) => state.setCenterView);
  const deleteActiveSurface = useAppStore((state) => state.deleteActiveA2uiSurface);
  const deleteRejectedInspection = useAppStore((state) => state.deleteRejectedA2uiInspection);
  const executeAction = useAppStore((state) => state.executeA2uiAction);
  const [copied, setCopied] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteInspectionConfirmOpen, setDeleteInspectionConfirmOpen] = useState(false);
  const [deleteInspectionTargetId, setDeleteInspectionTargetId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<A2uiCapabilities | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const surface = surfaces.find((item) => item.surfaceId === activeSurfaceId) ?? surfaces[0];
  const inspection =
    inspections.find((item) => item.id === activeInspectionId) ??
    inspections.find((item) => item.surfaceId === surface?.surfaceId) ??
    inspections[0];
  const validation = inspection?.validation ?? surface?.validation;
  const rawMessage = inspection?.rawMessage ?? surface?.rawMessage ?? '';
  const minimalRepro = useMemo(
    () =>
      JSON.stringify(
        {
          rawMessage,
          validation,
          componentTree: surface?.root ?? null,
          data: surface?.data ?? null,
          events: surface?.events ?? [],
        },
        null,
        2
      ),
    [rawMessage, surface, validation]
  );

  useEffect(() => {
    if (runtimeMode !== 'desktop') return;
    let active = true;
    void a2uiController
      .getCapabilities()
      .then((value) => {
        if (active) setCapabilities(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [runtimeMode]);

  if (!surface && !inspection) {
    return (
      <div className={styles.empty}>
        <Empty
          image={<EmptyIllustration />}
          styles={{ image: { height: 140 } }}
          description={t('noA2uiSurface')}
        />
      </div>
    );
  }

  return (
    <section className={styles.workbench} aria-label={t('a2uiRuntime')}>
      <header className={styles.header}>
        <div>
          <SafetyOutlined />
          <strong>{t('a2uiRuntime')}</strong>
          {capabilities ? <Tag color="blue">A2UI {capabilities.preferredVersion}</Tag> : null}
          {showInspector && surface ? <Tag color="purple">r{surface.revision}</Tag> : null}
        </div>
        <div className={styles.headerActions}>
          {showInspector ? (
            <div className={styles.selectors}>
              {surfaces.length ? (
                <Select
                  size="small"
                  aria-label={t('surface')}
                  value={surface?.surfaceId}
                  disabled={actionLoading || deleteConfirmOpen || deleteInspectionConfirmOpen}
                  options={surfaces.map((item, index) => ({
                    value: item.surfaceId,
                    label: `${t('interactiveResult')} ${index + 1}`,
                    title: item.surfaceId,
                  }))}
                  onChange={setActiveSurface}
                />
              ) : null}
              <Select
                size="small"
                aria-label={t('inspectionMessage')}
                value={inspection?.id}
                disabled={actionLoading || deleteConfirmOpen || deleteInspectionConfirmOpen}
                options={inspections.map((item, index) => ({
                  value: item.id,
                  label: `${t('inspectionRecord')} ${index + 1} · ${t(
                    item.validation.valid ? 'inspectionPassed' : 'inspectionRejected'
                  )}${index === 0 ? ` · ${t('latest')}` : ''}`,
                  title: item.surfaceId ?? item.messageId,
                }))}
                onChange={setActiveInspection}
              />
            </div>
          ) : null}
          {surface && runtimeMode === 'desktop' ? (
            <Button
              size="small"
              icon={<SaveOutlined />}
              disabled={actionLoading}
              onClick={() => {
                setTemplateName('');
                setTemplateNotice(null);
                setSaveTemplateOpen(true);
              }}
            >
              {t('saveAsPersonalTemplate')}
            </Button>
          ) : null}
          {surface ? (
            <Popconfirm
              title={t('deleteA2uiSurfaceTitle')}
              description={t('deleteA2uiSurfaceDescription')}
              okText={t('deletePermanently')}
              cancelText={t('cancel')}
              okButtonProps={{ danger: true }}
              disabled={actionLoading}
              open={deleteConfirmOpen}
              onOpenChange={(open) => {
                setDeleteConfirmOpen(open);
                setDeleteTargetId(open ? surface.surfaceId : null);
              }}
              onCancel={() => {
                setDeleteConfirmOpen(false);
                setDeleteTargetId(null);
              }}
              onConfirm={() => {
                const surfaceId = deleteTargetId;
                setDeleteConfirmOpen(false);
                setDeleteTargetId(null);
                return surfaceId ? deleteActiveSurface(surfaceId) : Promise.resolve();
              }}
            >
              <Button danger size="small" icon={<DeleteOutlined />} loading={actionLoading}>
                {t('deletePermanently')}
              </Button>
            </Popconfirm>
          ) : null}
          <Button size="small" aria-label={t('close')} onClick={() => setCenterView('editor')}>
            {t('close')}
          </Button>
        </div>
      </header>
      {notice ? <InfoNotice className={styles.notice} type="info" showIcon title={notice} /> : null}
      {templateNotice ? (
        <InfoNotice className={styles.notice} type="info" showIcon title={templateNotice} />
      ) : null}
      <div className={`${styles.columns} ${showInspector ? '' : styles.columnsSimple}`}>
        <div className={styles.runtimePane} aria-busy={actionLoading}>
          {surface && validation?.valid ? (
            <A2uiRuntime surface={surface} disabled={actionLoading} onAction={executeAction} />
          ) : (
            <Alert
              type="error"
              showIcon
              title={t('surfaceRejected')}
              description={t('surfaceRejectedDescription')}
            />
          )}
        </div>
        {showInspector ? (
          <aside className={styles.inspector} aria-label={t('a2uiInspector')}>
            <div className={styles.inspectorTitle}>
              <strong>{t('a2uiInspector')}</strong>
              <div className={styles.inspectorActions}>
                {inspection && !inspection.validation.valid ? (
                  <Popconfirm
                    title={t('deleteInspectionTitle')}
                    description={t('deleteInspectionDescription')}
                    okText={t('deleteInspection')}
                    cancelText={t('cancel')}
                    okButtonProps={{ danger: true }}
                    disabled={actionLoading}
                    open={deleteInspectionConfirmOpen}
                    onOpenChange={(open) => {
                      setDeleteInspectionConfirmOpen(open);
                      setDeleteInspectionTargetId(open ? inspection.id : null);
                    }}
                    onCancel={() => {
                      setDeleteInspectionConfirmOpen(false);
                      setDeleteInspectionTargetId(null);
                    }}
                    onConfirm={() => {
                      const inspectionId = deleteInspectionTargetId;
                      setDeleteInspectionConfirmOpen(false);
                      setDeleteInspectionTargetId(null);
                      return inspectionId
                        ? deleteRejectedInspection(inspectionId)
                        : Promise.resolve();
                    }}
                  >
                    <Button danger size="small" icon={<DeleteOutlined />} loading={actionLoading}>
                      {t('deleteInspection')}
                    </Button>
                  </Popconfirm>
                ) : null}
                <Button
                  size="small"
                  icon={copied ? <CheckCircleOutlined /> : <CopyOutlined />}
                  onClick={() => {
                    void navigator.clipboard.writeText(minimalRepro).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1200);
                    });
                  }}
                >
                  {copied ? t('copied') : t('copyRepro')}
                </Button>
              </div>
            </div>
            <p className={styles.inspectionHelp}>{t('inspectionHistoryHelp')}</p>
            <Tabs
              size="small"
              items={[
                {
                  key: 'schema',
                  label: t('schemaResult'),
                  children: (
                    <div className={styles.validation}>
                      <Alert
                        type={validation?.valid ? 'success' : 'error'}
                        showIcon
                        title={validation?.valid ? t('schemaPassed') : t('schemaFailed')}
                        description={`${validation?.durationMs ?? 0} ms`}
                      />
                      {validation?.errorCode ? <Tag color="red">{validation.errorCode}</Tag> : null}
                      {validation?.negotiation ? (
                        <p>
                          {t('a2uiNegotiation')}：
                          {validation.negotiation.receivedVersion ?? t('unknown')} →{' '}
                          {validation.negotiation.selectedVersion ?? t('notSupported')}
                          {validation.negotiation.catalogId
                            ? ` · ${validation.negotiation.catalogId}`
                            : ''}
                        </p>
                      ) : null}
                      {capabilities ? (
                        <p>
                          {t('a2uiCatalogCapability')}：{capabilities.catalog.catalogId} ·{' '}
                          {capabilities.catalog.components.length} {t('components')}
                        </p>
                      ) : null}
                      {validation?.errors.map((error) => (
                        <p key={error}>{error}</p>
                      ))}
                      {validation?.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ),
                },
                {
                  key: 'raw',
                  label: t('rawMessage'),
                  children: <pre>{rawMessage}</pre>,
                },
                {
                  key: 'tree',
                  label: t('componentTree'),
                  children: <pre>{JSON.stringify(surface?.root ?? null, null, 2)}</pre>,
                },
                {
                  key: 'data',
                  label: t('dataModel'),
                  children: <pre>{JSON.stringify(surface?.data ?? null, null, 2)}</pre>,
                },
                {
                  key: 'events',
                  label: `${t('events')} (${surface?.events.length ?? 0})`,
                  children: (
                    <div className={styles.events}>
                      {surface?.events.length ? (
                        surface.events.map((event) => (
                          <article key={event.id}>
                            <div>
                              <strong>{event.actionType}</strong>
                              <Tag color={event.decision === 'denied' ? 'red' : 'blue'}>
                                {event.decision}
                              </Tag>
                              <Tag>{event.risk}</Tag>
                            </div>
                            <small>
                              {event.componentId}.{event.eventName} · {event.durationMs} ms
                            </small>
                          </article>
                        ))
                      ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noEvents')} />
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </aside>
        ) : null}
      </div>
      <Modal
        title={t('saveAsPersonalTemplate')}
        open={saveTemplateOpen}
        okText={t('saveTemplate')}
        cancelText={t('cancel')}
        confirmLoading={templateSaving}
        okButtonProps={{ disabled: templateName.trim().length === 0 }}
        onCancel={() => setSaveTemplateOpen(false)}
        onOk={() => {
          const workspace = useAppStore.getState().workspace;
          if (!workspace || !surface) return;
          setTemplateSaving(true);
          void a2uiController
            .saveTemplate(workspace.id, surface.surfaceId, templateName)
            .then(() => {
              setSaveTemplateOpen(false);
              setTemplateNotice(t('templateSavedSafely'));
            })
            .catch((error: unknown) => {
              const message =
                typeof error === 'object' && error && 'message' in error
                  ? String((error as { message: unknown }).message)
                  : t('templateSaveFailed');
              setTemplateError(message);
            })
            .finally(() => setTemplateSaving(false));
        }}
      >
        <p>{t('templatePrivacyDescription')}</p>
        <Input
          autoFocus
          maxLength={80}
          value={templateName}
          placeholder={t('templateNamePlaceholder')}
          onChange={(event) => setTemplateName(event.target.value)}
          onPressEnter={() => undefined}
        />
      </Modal>
      <Modal
        title={t('templateSaveFailed')}
        open={templateError !== null}
        onCancel={() => setTemplateError(null)}
        footer={
          <Button type="primary" onClick={() => setTemplateError(null)}>
            {t('close')}
          </Button>
        }
      >
        <Alert type="error" showIcon title={templateError} />
      </Modal>
    </section>
  );
}
