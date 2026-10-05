import { BookOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Empty, Input } from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import type { WritingProject } from '../../shared/types/writingProject';
import styles from './ProjectSidebar.module.css';

export function ProjectSidebar({
  projects,
  activeId,
  onOpen,
  onCreate,
}: {
  projects: WritingProject[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [query, setQuery] = useState('');
  const visible = useMemo(
    () =>
      projects.filter((project) =>
        project.config.title.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [projects, query]
  );
  const isCompleted = (project: WritingProject) =>
    Boolean(project.resultId) &&
    project.publishedRevision === project.revision &&
    project.sections.every((section) => section.accepted);
  const ongoing = visible.filter((project) => !isCompleted(project));
  const completed = visible.filter(isCompleted);
  const updatedLabel = (value: string | null | undefined) => {
    if (!value) return '';
    const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
    if (Number.isNaN(date.getTime())) return '';
    const time = new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
    return date.toDateString() === new Date().toDateString()
      ? `${zh ? '今天' : 'Today'} ${time}`
      : new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', {
          month: 'numeric',
          day: 'numeric',
        }).format(date);
  };
  const renderGroup = (label: string, items: WritingProject[]) =>
    items.length > 0 && (
      <section className={styles.group} aria-label={label}>
        <h3>
          {label} <span>{items.length}</span>
        </h3>
        {items.map((project) => {
          const accepted = project.sections.filter((section) => section.accepted).length;
          const status =
            project.resultId && project.publishedRevision !== project.revision
              ? zh
                ? '待更新成果'
                : 'Result needs update'
              : project.sections.length
                ? `${accepted} / ${project.sections.length} ${zh ? '节已完成' : 'sections complete'}`
                : project.outlineConfirmed
                  ? zh
                    ? '大纲已确认'
                    : 'Outline confirmed'
                  : zh
                    ? '大纲待确认'
                    : 'Outline pending';
          const updated = updatedLabel(project.updatedAt);
          return (
            <button
              type="button"
              key={project.id}
              className={styles.item}
              data-active={activeId === project.id}
              onClick={() => onOpen(project.id)}
              title={project.config.title}
            >
              <BookOutlined aria-hidden="true" />
              <span className={styles.itemText}>
                <strong>{project.config.title}</strong>
                <small>
                  {status}
                  {updated && ` · ${updated}`}
                </small>
              </span>
            </button>
          );
        })}
      </section>
    );
  return (
    <aside className={styles.sidebar} aria-label={zh ? '项目列表' : 'Projects'}>
      <div className={styles.heading}>
        <h2>{zh ? '项目' : 'Projects'}</h2>
        <span>{projects.length}</span>
      </div>
      <Button block icon={<PlusOutlined />} onClick={onCreate}>
        {zh ? '新建项目' : 'New project'}
      </Button>
      <Input
        allowClear
        prefix={<SearchOutlined />}
        aria-label={zh ? '搜索项目' : 'Search projects'}
        placeholder={zh ? '搜索项目' : 'Search projects'}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={styles.list}>
        {renderGroup(zh ? '进行中' : 'In progress', ongoing)}
        {renderGroup(zh ? '已完成' : 'Completed', completed)}
        {visible.length === 0 && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              query
                ? zh
                  ? '没有匹配的项目'
                  : 'No matching projects'
                : zh
                  ? '还没有长文项目'
                  : 'No projects yet'
            }
          />
        )}
      </div>
    </aside>
  );
}
