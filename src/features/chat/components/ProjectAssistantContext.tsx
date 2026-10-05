import { BookOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Checkbox } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ContextSelection } from '../../../shared/types/domain';
import type { WritingProject, WritingSection } from '../../../shared/types/writingProject';
import styles from './ChatPanel.module.css';

export function ProjectAssistantContext({
  project,
  section,
  selection,
  onOpenContext,
  onTask,
}: {
  project: WritingProject | null;
  section: WritingSection | null;
  selection: ContextSelection;
  onOpenContext: () => void;
  onTask: (prompt: string) => void;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const sources =
    (selection.personalKnowledgeIds?.length ?? 0) +
    (selection.documentSourceIds?.length ?? 0) +
    (selection.contextPackIds?.length ?? 0);
  const outlineTasks = zh
    ? [
        ['优化大纲', '请检查当前项目大纲的逻辑、重复和缺失章节，给出具体建议；不要直接修改项目。'],
        ['检查缺失章节', '根据当前项目目标和读者，指出大纲中遗漏的章节及原因。'],
        ['检查一致性', '检查当前项目的目标、大纲和已完成章节摘要是否一致，指出冲突和待核实事实。'],
        ['生成下一节', '根据当前项目目标和大纲，建议下一节的写作结构与要点；不要直接写入项目。'],
      ]
    : [
        [
          'Improve outline',
          'Review the outline for gaps, repetition and logical flow. Do not modify the project.',
        ],
        [
          'Find missing sections',
          'Identify missing sections based on the project goal and audience.',
        ],
        [
          'Check consistency',
          'Check the goal, outline and accepted section summaries for inconsistencies.',
        ],
        [
          'Plan next section',
          'Suggest a structure and key points for the next section. Do not write to the project.',
        ],
      ];
  const sectionTasks = zh
    ? [
        ['继续写', '根据当前章节目标和已接受前文摘要，建议下一段内容；不要直接修改项目。'],
        ['扩写', '指出当前章节哪些论点需要补充解释、证据或例子；不要编造事实。'],
        ['检查事实', '检查当前章节正文中的数字、日期、实体和引用，标出缺少依据的内容。'],
        ['检查与前文冲突', '对照已接受章节摘要，指出当前章节的矛盾、重复和术语不一致。'],
      ]
    : [
        [
          'Continue writing',
          'Suggest the next paragraph from this section goal and approved earlier summaries. Do not edit the project.',
        ],
        [
          'Expand',
          'Identify claims needing explanation, evidence or examples. Do not invent facts.',
        ],
        ['Check facts', 'Check numbers, dates, entities and citations; flag unsupported claims.'],
        [
          'Check continuity',
          'Compare this section with approved earlier summaries for conflicts and repetition.',
        ],
      ];
  if (!project)
    return (
      <section className={styles.documentContext} aria-label={zh ? '当前项目' : 'Current project'}>
        <h2>{zh ? 'AI 协作' : 'AI collaboration'}</h2>
        <p>
          {zh
            ? '选择项目或完成新项目设置后，再启用 AI 协作。'
            : 'Choose a project or finish setup to enable AI collaboration.'}
        </p>
      </section>
    );
  return (
    <section className={styles.documentContext} aria-label={zh ? '当前项目' : 'Current project'}>
      <h2>{zh ? '当前项目' : 'Current project'}</h2>
      <div className={styles.contextDocument}>
        <BookOutlined />
        <strong>{section?.title ?? project.config.title}</strong>
      </div>
      {project && (
        <>
          <h2>{zh ? '上下文' : 'Context'}</h2>
          <div className={styles.contextSources}>
            <Checkbox checked={selection.selection} onChange={onOpenContext}>
              {section
                ? zh
                  ? '当前章节与项目大纲'
                  : 'Section and project outline'
                : zh
                  ? '项目目标与大纲'
                  : 'Goal and outline'}
            </Checkbox>
            <Checkbox checked={sources > 0} disabled>
              {zh ? `项目资料 ${sources} 项` : `${sources} project sources`}
            </Checkbox>
            <Button size="small" type="text" icon={<PlusOutlined />} onClick={onOpenContext}>
              {zh ? '添加资料' : 'Add material'}
            </Button>
          </div>
          <h2>{zh ? '快捷任务' : 'Quick tasks'}</h2>
          <div className={styles.contextTasks}>
            {(section ? sectionTasks : outlineTasks).map(([label, prompt]) => (
              <Button size="small" key={label} onClick={() => onTask(prompt)}>
                {label}
              </Button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
