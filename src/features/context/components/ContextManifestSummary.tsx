import { Button, Divider, Tag } from 'antd';
import { InfoNotice } from '../../../shared/components/InfoNotice';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ContextManifest } from '../../../shared/types/domain';
import { formatWritingProfileForDisplay } from '../../../shared/writingProfile';
import styles from './ContextSelector.module.css';
export function ContextManifestSummary({
  manifest,
  onClearIndex,
  indexClearing = false,
  compact = false,
}: {
  manifest: ContextManifest;
  onClearIndex?: () => void;
  indexClearing?: boolean;
  compact?: boolean;
}) {
  const { locale, t } = useI18n();
  return (
    <div className={styles.manifest}>
      {!compact && <Divider>{t('trustedManifest')}</Divider>}
      {!compact && (
        <InfoNotice
          type="info"
          showIcon
          title={t(
            manifest.strategy === 'full'
              ? 'contextStrategyFull'
              : manifest.strategy === 'retrieval'
                ? 'contextStrategyRetrieval'
                : 'contextStrategyHybrid'
          )}
          description={
            manifest.indexMode === 'memory_lexical'
              ? t('contextMemoryIndexDescription').replace(
                  '{count}',
                  String(manifest.retrievedChunkCount)
                )
              : t('contextFullDescription')
          }
        />
      )}
      <strong>{t('writingProfileSnapshot')}</strong>
      <div className={styles.manifestList}>
        {manifest.writingProfile.enabled ? (
          manifest.writingProfile.layers.map((layer) => (
            <Tag color="blue" key={layer.id}>
              {layer.scope === 'global' ? t('globalWritingProfile') : t('workspaceWritingProfile')}
            </Tag>
          ))
        ) : (
          <Tag>{t('writingProfileDisabled')}</Tag>
        )}
        <Tag>{manifest.writingProfile.composerVersion}</Tag>
        <Tag title={manifest.writingProfile.hash}>
          {t('writingProfileHash').replace('{hash}', manifest.writingProfile.hash.slice(0, 12))}
        </Tag>
        <Tag>{manifest.writingProfile.estimatedTokens.toLocaleString()} tokens</Tag>
      </div>
      {!compact && manifest.writingProfile.enabled && (
        <details className={styles.profileDetails}>
          <summary>{t('viewEffectiveWritingRules')}</summary>
          <pre>{formatWritingProfileForDisplay(manifest.writingProfile, locale)}</pre>
          {manifest.writingProfile.exampleKnowledgeIds.length > 0 && (
            <p>{t('profileExamplesRequireContext')}</p>
          )}
        </details>
      )}
      <strong>{t('includedSources')}</strong>
      <div className={styles.manifestList}>
        {manifest.includedSources.length === 0 ? (
          <Tag>{t('noFileContext')}</Tag>
        ) : (
          manifest.includedSources.map((source) => (
            <Tag color="green" key={`${source.kind}:${source.label}`}>
              {source.label} · {source.characterCount.toLocaleString()} chars
              {source.mode === 'retrieved'
                ? ` · ${source.selectedRanges.length} ${t('contextChunks')}`
                : ''}
            </Tag>
          ))
        )}
      </div>
      {!compact &&
        manifest.includedSources
          .filter((source) => source.mode === 'retrieved')
          .map((source) => (
            <div className={styles.manifestRanges} key={`ranges:${source.kind}:${source.label}`}>
              <span>{t('contextSelectedRanges').replace('{source}', source.label)}</span>
              <code>
                {source.selectedRanges
                  .map(
                    (range) =>
                      `${range.chunkId} [${range.startCharacter.toLocaleString()}–${range.endCharacter.toLocaleString()}]`
                  )
                  .join(' · ')}
              </code>
            </div>
          ))}
      {(!compact || manifest.excludedSources.length > 0) && <strong>{t('excludedSources')}</strong>}
      <div className={styles.manifestExcluded}>
        {manifest.excludedSources.map((source) => (
          <span key={`${source.kind}:${source.label}`}>
            {source.label}: {source.exclusionReason}
          </span>
        ))}
      </div>
      {onClearIndex && (
        <Button size="small" loading={indexClearing} onClick={onClearIndex}>
          {t('clearContextIndex')}
        </Button>
      )}
    </div>
  );
}
