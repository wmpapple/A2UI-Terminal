import { CheckOutlined } from '@ant-design/icons';
import type {
  WritingPlan,
  WritingProject,
  WritingSection,
} from '../../shared/types/writingProject';
import { ContextManifestSummary } from '../context/components/ContextManifestSummary';
import { useI18n } from '../../app/i18n/useI18n';
import styles from './WritingProjectsPage.module.css';

export function WritingSendSummary({
  plan,
  project,
  section,
  professional,
}: {
  plan: WritingPlan;
  project: WritingProject | null;
  section: WritingSection | undefined;
  professional: boolean;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const previous =
    project && section
      ? project.sections
          .slice(
            0,
            project.sections.findIndex((item) => item.id === section.id)
          )
          .filter((item) => item.accepted).length
      : 0;
  const manifest = plan.manifest;
  return (
    <div className={styles.sendSummary}>
      <section>
        <h3>{zh ? '将使用' : 'Will use'}</h3>
        <p>
          <CheckOutlined />{' '}
          {zh
            ? '项目目标、读者、关键事实、术语与大纲'
            : 'Project goal, audience, facts, terminology and outline'}
        </p>
        {section && (
          <p>
            <CheckOutlined />{' '}
            {zh ? `当前章节：${section.title}` : `Current section: ${section.title}`}
          </p>
        )}
        {previous > 0 && (
          <p>
            <CheckOutlined />{' '}
            {zh ? `前文摘要（${previous} 节）` : `Earlier section summaries (${previous})`}
          </p>
        )}
        {section?.content.trim() && (
          <p>
            <CheckOutlined /> {zh ? '本章已接受的正文' : 'Approved current-section text'}
          </p>
        )}
        {manifest.includedSources.length > 0 ? (
          manifest.includedSources.map((source, index) => (
            <p key={`${source.kind}:${index}`}>
              <CheckOutlined /> {source.label} ·{' '}
              {source.mode === 'retrieved'
                ? zh
                  ? '选中的片段'
                  : 'selected passages'
                : zh
                  ? '已确认范围'
                  : 'approved scope'}
            </p>
          ))
        ) : (
          <p className={styles.sendMuted}>
            {zh ? '未选择额外资料文件' : 'No additional source files selected'}
          </p>
        )}
      </section>
      <section>
        <h3>{zh ? '不会使用' : 'Will not use'}</h3>
        <p>
          {zh
            ? '其他工作区文件、最近对话、未选择的个人资料'
            : 'Other workspace files, recent conversations or unselected personal sources'}
        </p>
      </section>
      <div className={styles.sendMeta}>
        <span>
          {zh ? '写作偏好' : 'Writing preferences'}：
          {manifest.writingProfile.enabled
            ? zh
              ? '已启用'
              : 'Enabled'
            : zh
              ? '未启用'
              : 'Disabled'}
        </span>
        <span>
          {zh ? '处理方式' : 'Processing'}：
          {manifest.processingLocation === 'cloud'
            ? zh
              ? '云端模型'
              : 'Cloud model'
            : zh
              ? '本地模型'
              : 'Local model'}
        </span>
      </div>
      {professional && (
        <details className={styles.sendDetails}>
          <summary>{zh ? '查看技术清单与本次指令' : 'Technical manifest and request'}</summary>
          <ContextManifestSummary
            manifest={manifest}
            compact
            emptySourcesLabel={
              zh
                ? '未选择额外资料；项目指令可能包含已接受的本章正文'
                : 'No extra sources selected; the project request may include approved section text'
            }
          />
          <pre>{plan.prompt}</pre>
        </details>
      )}
    </div>
  );
}
