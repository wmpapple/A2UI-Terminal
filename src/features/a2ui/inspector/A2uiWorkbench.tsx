import { CheckCircleOutlined, CopyOutlined, SafetyOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Select, Tabs, Tag } from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import { A2uiRuntime } from '../runtime/A2uiRuntime';
import styles from './A2uiWorkbench.module.css';

export function A2uiWorkbench() {
  const { t } = useI18n();
  const surfaces = useAppStore((state) => state.a2uiSurfaces);
  const inspections = useAppStore((state) => state.a2uiInspections);
  const activeSurfaceId = useAppStore((state) => state.activeSurfaceId);
  const activeInspectionId = useAppStore((state) => state.activeInspectionId);
  const actionLoading = useAppStore((state) => state.a2uiActionLoading);
  const notice = useAppStore((state) => state.a2uiNotice);
  const setActiveSurface = useAppStore((state) => state.setActiveSurface);
  const setActiveInspection = useAppStore((state) => state.setActiveInspection);
  const executeAction = useAppStore((state) => state.executeA2uiAction);
  const [copied, setCopied] = useState(false);
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

  if (!surface && !inspection) {
    return (
      <div className={styles.empty}>
        <Empty description={t('noA2uiSurface')} />
      </div>
    );
  }

  return (
    <section className={styles.workbench} aria-label={t('a2uiRuntime')}>
      <header className={styles.header}>
        <div>
          <SafetyOutlined />
          <strong>{t('a2uiRuntime')}</strong>
          {surface ? <Tag color="purple">r{surface.revision}</Tag> : null}
        </div>
        <div className={styles.selectors}>
          {surfaces.length ? (
            <Select
              size="small"
              aria-label={t('surface')}
              value={surface?.surfaceId}
              options={surfaces.map((item) => ({ value: item.surfaceId, label: item.surfaceId }))}
              onChange={setActiveSurface}
            />
          ) : null}
          <Select
            size="small"
            aria-label={t('inspectionMessage')}
            value={inspection?.id}
            options={inspections.map((item) => ({
              value: item.id,
              label: `${item.validation.valid ? '✓' : '✕'} ${item.surfaceId ?? item.messageId}`,
            }))}
            onChange={setActiveInspection}
          />
        </div>
      </header>
      {notice ? <Alert className={styles.notice} type="info" showIcon title={notice} /> : null}
      <div className={styles.columns}>
        <div className={styles.runtimePane} aria-busy={actionLoading}>
          {surface && validation?.valid ? (
            <A2uiRuntime surface={surface} disabled={actionLoading} onAction={executeAction} />
          ) : (
            <Alert
              type="error"
              showIcon
              title={t('surfaceRejected')}
              description={validation?.errors.join('；')}
            />
          )}
        </div>
        <aside className={styles.inspector} aria-label={t('a2uiInspector')}>
          <div className={styles.inspectorTitle}>
            <strong>{t('a2uiInspector')}</strong>
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
      </div>
    </section>
  );
}
