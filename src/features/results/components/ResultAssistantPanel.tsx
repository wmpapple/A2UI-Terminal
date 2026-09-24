import { InfoNotice } from '../../../shared/components/InfoNotice';
import { Spin } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import { useResultStore } from '../resultStore';
import { GenerationPanel } from '../../generation/GenerationPanel';

export function ResultAssistantPanel({
  resultId,
  onOpenResult,
}: {
  resultId: string;
  onOpenResult: (id: string) => void;
}) {
  const { locale } = useI18n();
  const document = useResultStore((s) => s.activeDocument);
  const status = useResultStore((s) => s.saveStatus);
  const open = useResultStore((s) => s.openResult);
  if (!document || document.result.id !== resultId) return <Spin />;
  if (document.result.type !== 'document')
    return (
      <InfoNotice
        type="info"
        title={
          locale === 'zh-CN'
            ? '本阶段 AI 写作支持文档成果；当前成果可继续手工编辑'
            : 'AI writing currently supports document results; this result remains manually editable'
        }
      />
    );
  return (
    <GenerationPanel
      key={resultId}
      resultId={resultId}
      targetTitle={document.result.title}
      workspaceId={document.result.workspaceId}
      blocked={status !== 'saved' || Boolean(document.recoveryDraft)}
      onApplied={(id) => {
        if (id === resultId) void open(id);
        else onOpenResult(id);
      }}
    />
  );
}
