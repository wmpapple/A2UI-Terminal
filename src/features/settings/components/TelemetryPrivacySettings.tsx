import { InfoNotice } from '../../../shared/components/InfoNotice';
import {
  ExclamationCircleOutlined,
  EyeOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Alert, Button, List, Modal, Spin, Switch, Tag, Tooltip, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { getRuntimeMode } from '../../../shared/platform/runtime';
import type { TelemetryDictionary, TelemetrySettings } from '../../../shared/types/domain';
import { systemController } from '../systemController';
import styles from './SystemSettings.module.css';

const KPI_LABELS = {
  task_completion_rate: 'kpiTaskCompletion',
  review_adoption_rate: 'kpiReviewAdoption',
  accepted_patch_rate: 'kpiAcceptedPatch',
  undo_rate: 'kpiUndo',
  export_save_rate: 'kpiExportSave',
  context_confirmation_rate: 'kpiContextConfirmation',
} as const;

export function TelemetryPrivacySettings() {
  const { locale, t } = useI18n();
  const desktop = getRuntimeMode() === 'desktop';
  const [settings, setSettings] = useState<TelemetrySettings | null>(null);
  const [dictionary, setDictionary] = useState<TelemetryDictionary | null>(null);
  const [loading, setLoading] = useState(desktop);
  const [saving, setSaving] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void systemController
      .getTelemetrySettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(() => {
        if (active) message.error(t('telemetryLoadFailed'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [desktop, t]);

  const update = async (enabled: boolean, dismissInvitation = false) => {
    setSaving(true);
    try {
      const next = await systemController.setTelemetrySettings(enabled, dismissInvitation);
      setSettings(next);
      message.success(t(enabled ? 'telemetryEnabled' : 'telemetryDisabled'));
    } catch {
      message.error(t('telemetrySaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const showDictionary = async () => {
    setDictionaryOpen(true);
    if (dictionary || !desktop) return;
    try {
      setDictionary(await systemController.exportEventDictionary());
    } catch {
      message.error(t('telemetryDictionaryFailed'));
    }
  };

  if (!desktop) {
    return <InfoNotice type="info" showIcon title={t('telemetryDesktopOnly')} />;
  }

  if (loading || !settings) return <Spin size="small" />;

  const invite = settings.invitationEligible && !settings.invitationDismissed && !settings.enabled;

  return (
    <section className={styles.telemetryPanel} aria-label={t('telemetryPrivacyTitle')}>
      <div className={styles.heading}>
        <div>
          <h3>{t('telemetryPrivacyTitle')}</h3>
          <Typography.Text type="secondary">{t('telemetryPrivacyDescription')}</Typography.Text>
        </div>
        <Switch
          aria-label={t('helpImproveProduct')}
          checked={settings.enabled}
          loading={saving}
          checkedChildren={t('enabled')}
          unCheckedChildren={t('disabled')}
          onChange={(checked) => void update(checked)}
        />
      </div>

      {invite ? (
        <InfoNotice
          type="info"
          showIcon
          title={t('telemetryInvitationTitle')}
          description={t('telemetryInvitationDescription')}
          action={
            <div className={styles.telemetryInviteActions}>
              <Button
                size="small"
                type="primary"
                loading={saving}
                onClick={() => void update(true, true)}
              >
                {t('enableAnonymousMetrics')}
              </Button>
              <Button size="small" disabled={saving} onClick={() => void update(false, true)}>
                {t('notNow')}
              </Button>
            </div>
          }
        />
      ) : null}

      {!settings.enabled && settings.invitationDismissed ? (
        <Typography.Text type="secondary">{t('telemetryInvitationHandled')}</Typography.Text>
      ) : null}

      <Alert
        type="success"
        showIcon
        icon={<SafetyCertificateOutlined />}
        title={t(settings.enabled ? 'telemetryLocalCollectionOn' : 'telemetryCollectionOff')}
        description={t('telemetryNoUpload')}
      />

      <div className={styles.actions}>
        <Button icon={<EyeOutlined />} onClick={() => void showDictionary()}>
          {t('viewTelemetryData')}
        </Button>
        <Tag>
          {t('telemetryLocalEventCount')}: {settings.localEventCount}
        </Tag>
      </div>

      <div className={styles.kpiPanel}>
        <div className={styles.kpiHeading}>
          <strong>{t('telemetryCoreKpis')}</strong>
          <Tooltip
            trigger={['hover', 'focus']}
            placement="top"
            color="#1e293b"
            styles={{
              root: { maxWidth: 'min(420px, calc(100vw - 32px))' },
              container: {
                padding: 16,
                border: '1px solid #334155',
                borderRadius: 12,
                boxShadow: '0 12px 32px #0f172a26',
                color: '#f1f5f9',
              },
            }}
            title={
              <ul className={styles.kpiExplanation}>
                <li>{t('telemetryKpiPurpose')}</li>
                <li>{t('telemetryRateRule')}</li>
                <li>{t('telemetrySaveRule')}</li>
                <li>{t('telemetryReviewRule')}</li>
              </ul>
            }
          >
            <button type="button" className={styles.kpiHelp} aria-label={t('telemetryKpiHelp')}>
              <ExclamationCircleOutlined aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <div className={styles.kpiGrid}>
          {settings.kpis.map((kpi) => (
            <div key={kpi.key}>
              <span className={styles.kpiLabel}>{t(KPI_LABELS[kpi.key])}</span>
              <span className={kpi.rateBasisPoints === null ? styles.kpiEmpty : styles.kpiValue}>
                {kpi.rateBasisPoints === null
                  ? kpi.numerator > 0
                    ? `${t('telemetryRecordedCount')}: ${kpi.numerator} · ${t('telemetryMissingBaseline')}`
                    : t('telemetryNoKpiData')
                  : `${(kpi.rateBasisPoints / 100).toFixed(1)}% (${kpi.numerator}/${kpi.denominator})`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Modal
        width={760}
        open={dictionaryOpen}
        title={t('telemetryDictionaryTitle')}
        footer={null}
        onCancel={() => setDictionaryOpen(false)}
      >
        {!dictionary ? (
          <Spin size="small" />
        ) : (
          <div className={styles.eventDictionary}>
            <InfoNotice type="info" showIcon title={t('telemetryNoUpload')} />
            <div>
              <strong>{t('telemetryCommonFields')}</strong>
              <div className={styles.fieldList}>
                {dictionary.commonFields.map((field) => (
                  <Tag key={field}>{field}</Tag>
                ))}
              </div>
            </div>
            <div>
              <strong>{t('telemetryNeverCollected')}</strong>
              <div className={styles.fieldList}>
                {dictionary.neverCollected.map((field) => (
                  <Tag key={field}>{field}</Tag>
                ))}
              </div>
            </div>
            <List
              size="small"
              dataSource={dictionary.events}
              renderItem={(event) => (
                <List.Item className={styles.eventItem}>
                  <div>
                    <strong>
                      {locale === 'zh-CN' ? event.descriptionZh : event.descriptionEn}
                    </strong>
                    <Typography.Text code>{event.name}</Typography.Text>
                    <div className={styles.fieldList}>
                      {event.fields.map((field) => (
                        <Tag key={field}>{field}</Tag>
                      ))}
                    </div>
                  </div>
                  <Tag>{dictionary.localEventCounts[event.name] ?? 0}</Tag>
                </List.Item>
              )}
            />
          </div>
        )}
      </Modal>
    </section>
  );
}
