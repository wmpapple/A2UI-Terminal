import { Alert, Button, Input, Space, Tag } from 'antd';
import { useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import type { WritingRun, WritingSection } from '../../shared/types/writingProject';
import { errorDetails } from '../../stores/support';
import { AssistantMarkdown } from '../chat/components/ChatMessageList';
import { CitationPanel } from '../citation/CitationPanel';
import { ContextManifestSummary } from '../context/components/ContextManifestSummary';
import { writingProjectController as api } from './writingProjectController';

export function SectionReview({
  run,
  section,
  disabled,
  onAccept,
}: {
  run: WritingRun;
  section: WritingSection;
  disabled: boolean;
  onAccept: (content: string, summary: string) => Promise<void>;
}) {
  const { locale } = useI18n();
  const say = (cn: string, en: string) => (locale === 'zh-CN' ? cn : en);
  const [content, setContent] = useState(
    run.draft?.content ?? (section.runId === run.id ? section.content : run.content)
  );
  const [summary, setSummary] = useState(
    run.draft?.summary ?? (section.runId === run.id ? section.summary : '')
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const version = useRef(0);
  const update = (text: string, facts: string) => {
    setContent(text);
    setSummary(facts);
    setSaving(true);
    const ticket = ++version.current;
    void api
      .saveDraft(run.id, text, facts)
      .then(() => {
        if (ticket === version.current) {
          setSaving(false);
          setError('');
        }
      })
      .catch((e) => {
        if (ticket === version.current) {
          setSaving(false);
          setError(errorDetails(e).message);
        }
      });
  };
  return (
    <section aria-label={say('章节审阅', 'Section review')}>
      {error && <Alert type="error" title={error} closable onClose={() => setError('')} />}
      {['cancelled', 'failed', 'interrupted'].includes(run.status) && (
        <Alert
          showIcon
          type="warning"
          closable
          title={say(
            '这是中断后保留的部分内容。请补全并核对后再接受，或重新生成。',
            'This is a partial response. Complete and review it before accepting, or retry.'
          )}
        />
      )}
      <p>
        {say(
          '正文草稿自动保存在本机；接受后才用于最终成果。',
          'Drafts are saved locally. Only accepted text enters the final result.'
        )}
      </p>
      <Input.TextArea
        aria-label={say('章节正文', 'Section content')}
        value={content}
        maxLength={100000}
        autoSize={{ minRows: 10, maxRows: 24 }}
        disabled={disabled}
        onChange={(e) => update(e.target.value, summary)}
      />
      <p>
        {say(
          '本章事实摘要（后续章节会使用，请保留数字、日期、否定关系和未决事项）',
          'Continuity summary (retain numbers, dates, negations and unresolved matters)'
        )}
      </p>
      <Input.TextArea
        aria-label={say('本章事实摘要', 'Continuity summary')}
        value={summary}
        maxLength={1500}
        autoSize={{ minRows: 3, maxRows: 8 }}
        disabled={disabled}
        onChange={(e) => update(content, e.target.value)}
      />
      <Space style={{ marginTop: 12 }} wrap>
        <Tag>
          {saving
            ? say('正在保存草稿…', 'Saving draft…')
            : error
              ? say('草稿未保存', 'Draft not saved')
              : say('草稿已保存', 'Draft saved')}
        </Tag>
        <Button
          type="primary"
          disabled={disabled || saving || !content.trim() || !summary.trim()}
          onClick={() => void onAccept(content, summary)}
        >
          {say('接受本章正文与摘要', 'Accept section and summary')}
        </Button>
      </Space>
      <details style={{ marginTop: 16 }}>
        <summary>{say('阅读预览', 'Reading preview')}</summary>
        <AssistantMarkdown content={content} streaming={false} />
      </details>
      <CitationPanel
        ownerKind="writing_run"
        ownerId={run.id}
        content={content}
        dirty={content !== run.content}
      />
      <details>
        <summary>
          {say('本次生成使用的资料和写作偏好', 'Sources and writing preferences used for this run')}
        </summary>
        <ContextManifestSummary manifest={run.snapshot.manifest} />
        <pre style={{ whiteSpace: 'pre-wrap' }}>{run.snapshot.prompt}</pre>
      </details>
    </section>
  );
}
