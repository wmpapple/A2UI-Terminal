import {
  DeleteOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileTextOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { Alert, Button, Modal, Popconfirm, Spin, Tag } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import { useImportStore } from '../importStore';
import styles from './DocumentSourcePanel.module.css';

interface DocumentSourcePanelProps {
  onSourceRemoved?: (sourceId: string) => void;
}

export function DocumentSourcePanel({ onSourceRemoved }: DocumentSourcePanelProps) {
  const { t } = useI18n();
  const sources = useImportStore((state) => state.sources);
  const content = useImportStore((state) => state.sourceContent);
  const loading = useImportStore((state) => state.sourceLoading);
  const revokingSourceId = useImportStore((state) => state.revokingSourceId);
  const previewSource = useImportStore((state) => state.previewSource);
  const revokeSource = useImportStore((state) => state.revokeSource);
  const closePreview = useImportStore((state) => state.closeSourcePreview);

  if (sources.length === 0) return null;

  const sheet = content?.tableContent?.sheets[0];
  const visibleRows = sheet?.rows.slice(0, 50) ?? [];

  return (
    <section className={styles.panel} aria-label={t('authorizedSources')}>
      <div className={styles.heading}>
        <strong>{t('authorizedSources')}</strong>
        <span>{t('sourceNotSent')}</span>
      </div>
      <div className={styles.sources}>
        {sources.map((source) => (
          <article key={source.id} className={styles.source}>
            <span className={styles.sourceIcon}>
              {source.kind === 'table' ? (
                <TableOutlined />
              ) : source.kind === 'image' ? (
                <FileImageOutlined />
              ) : (
                <FileTextOutlined />
              )}
            </span>
            <div className={styles.sourceBody}>
              <strong>{source.name}</strong>
              {source.table ? (
                <span>
                  {t('sourceTableSummary')
                    .replace('{rows}', String(source.table.rowCount))
                    .replace('{columns}', String(source.table.columnCount))}
                </span>
              ) : null}
              {source.image ? (
                <span>
                  {t('sourceImageSummary')
                    .replace('{width}', String(source.image.width))
                    .replace('{height}', String(source.image.height))}
                </span>
              ) : null}
            </div>
            <Tag
              color={
                source.kind === 'table' ? 'blue' : source.kind === 'image' ? 'purple' : 'green'
              }
            >
              {source.kind === 'table'
                ? t('sourceKindTable')
                : source.kind === 'image'
                  ? t('sourceKindImage')
                  : t('sourceKindText')}
            </Tag>
            {source.kind !== 'text' ? (
              <Button
                size="small"
                icon={<EyeOutlined />}
                loading={loading}
                onClick={() => void previewSource(source.id)}
              >
                {t('localPreview')}
              </Button>
            ) : null}
            <Popconfirm
              title={t('revokeSourceTitle').replace('{name}', source.name)}
              description={t('revokeSourceDescription')}
              okText={t('revokeSourceConfirm')}
              cancelText={t('revokeSourceCancel')}
              okButtonProps={{ danger: true }}
              onConfirm={async () => {
                const revoked = await revokeSource(source.workspaceId, source.id);
                if (revoked) onSourceRemoved?.(source.id);
              }}
            >
              <Button
                danger
                size="small"
                icon={<DeleteOutlined />}
                loading={revokingSourceId === source.id}
                disabled={Boolean(revokingSourceId && revokingSourceId !== source.id)}
              >
                {t('revokeSource')}
              </Button>
            </Popconfirm>
          </article>
        ))}
      </div>
      <Modal
        open={Boolean(content)}
        title={content ? `${t('localPreview')} · ${content.source.name}` : t('localPreview')}
        width={900}
        footer={null}
        destroyOnHidden
        onCancel={closePreview}
      >
        {content ? <Alert type="info" showIcon title={content.notice} /> : <Spin />}
        {content?.source.kind === 'image' ? (
          content.imageDataUrl ? (
            <img
              className={styles.imagePreview}
              src={content.imageDataUrl}
              alt={content.source.name}
            />
          ) : (
            <Alert
              className={styles.previewNotice}
              type="warning"
              title={t('imagePreviewUnavailable')}
            />
          )
        ) : null}
        {sheet ? (
          <div className={styles.tableWrap}>
            <table>
              <caption>
                {sheet.name} · {t('tablePreviewLimit')}
              </caption>
              <tbody>
                {visibleRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.slice(0, 20).map((cell, columnIndex) => (
                      <td
                        key={columnIndex}
                        className={cell.formulaInjectionRisk ? styles.riskCell : undefined}
                        title={cell.formulaInjectionRisk ? t('formulaRiskCell') : undefined}
                      >
                        {cell.value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
