import { InfoNotice } from '../../../shared/components/InfoNotice';
import { Spin } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import { useResultStore } from '../resultStore';
import { GenerationPanel } from '../../generation/GenerationPanel';

export function ResultAssistantPanel({
  resultId,
  onOpenResult,
  onOpenSettings,
}: {
  resultId: string;
  onOpenResult: (id: string) => void;
  onOpenSettings?: () => void;
}) {
  const { locale } = useI18n();
  const document = useResultStore((s) => s.activeDocument);
  const status = useResultStore((s) => s.saveStatus);
  const open = useResultStore((s) => s.openResult);
  if (!document || document.result.id !== resultId) return <Spin />;
  if (document.result.type !== 'document')
    return (
      <div style={{ padding: 16, alignSelf: 'start' }}>
        <InfoNotice
          type="info"
          title={
            document.result.a2uiSurfaceId?.startsWith('scene-snapshot-')
              ? locale === 'zh-CN'
                ? '这是手动保存的成果快照。继续填写请到“工作台 → 我的工具”；填写后需手动更新成果。'
                : 'This is a manually saved snapshot. Continue under Workbench → My Tools, then explicitly update the result.'
              : document.result.a2uiSurfaceId
                ? locale === 'zh-CN'
                  ? '此工具在本机填写并自动保存，无需调用 AI。填写完成后，可导出或存为个人模板。'
                  : 'This tool saves locally without AI. Export the completed entries or save the fields as a personal template.'
                : locale === 'zh-CN'
                  ? '本阶段 AI 写作支持文档成果；当前成果可继续手工编辑'
                  : 'AI writing currently supports document results; this result remains manually editable'
          }
        />
      </div>
    );
  return (
    <GenerationPanel
      key={resultId}
      resultId={resultId}
      targetTitle={document.result.title}
      workspaceId={document.result.workspaceId}
      blocked={status !== 'saved' || Boolean(document.recoveryDraft)}
      onOpenSettings={onOpenSettings}
      onApplied={(id) => {
        if (id === resultId) void open(id);
        else onOpenResult(id);
      }}
    />
  );
}
