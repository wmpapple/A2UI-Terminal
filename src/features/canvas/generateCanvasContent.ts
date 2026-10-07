import { desktopGateway } from '../../shared/platform/gateway';
import { getRuntimeMode } from '../../shared/platform/runtime';
import { useAppStore } from '../../stores/useAppStore';

const instruction = (kind: string, custom: string) => {
  const format =
    kind.includes('流程') || kind.includes('导图')
      ? '用中文输出编号步骤列表，每行一个简短步骤，按先后顺序排列；不要 Mermaid、JSON 或代码围栏。'
      : '用中文输出适合画布阅读的结构化 Markdown，包含标题与要点；不要 document_patch JSON、代码围栏或修改文件的操作。内容准确、简洁，不能编造证据。';
  return `请基于明确选择的文档生成「${kind}」。${format}${custom.trim() ? `\n补充要求：${custom.trim()}` : ''}`;
};

export async function generateCanvasContent({
  workspaceId,
  paths,
  kind,
  customPrompt,
  confirm,
}: {
  workspaceId: string;
  paths: string[];
  kind: string;
  customPrompt: string;
  confirm: (detail: string) => Promise<boolean>;
}): Promise<{ content: string; raw: string; sourceHash?: string }> {
  if (getRuntimeMode() !== 'desktop') throw new Error('AI 生成需要桌面版和已配置的模型');
  const state = useAppStore.getState();
  const providerId = state.activeProviderId;
  if (!paths.length || paths.length > 20) throw new Error('请选择 1–20 个来源文件');
  const sources = await Promise.all(
    paths.map(async (path) => ({
      path,
      file:
        state.files.find((file) => file.path === path) ??
        (await desktopGateway.readWorkspaceFile(workspaceId, path)),
    }))
  );
  const prompt = instruction(kind, customPrompt);
  const sessionId = crypto.randomUUID();
  await desktopGateway.createChatSession(workspaceId, sessionId, `画布生成 · ${kind}`);
  const manifest = await desktopGateway.planContext({
    workspaceId,
    sessionId,
    providerId,
    prompt,
    candidates: sources.map(({ path, file }, index) => ({
      kind: index === 0 ? ('current_file' as const) : ('project_file' as const),
      label: path,
      selected: true,
      sourceId: file.sourceId,
      content: file.content,
      baseHash: file.contentHash,
    })),
    includeRecentMessages: false,
    recentMessageCount: 0,
    contextPackIds: [],
  });
  const accepted = await confirm(
    `将使用：${manifest.includedSources.map((item) => item.label).join('、') || paths.join('、')}。${manifest.sensitiveWarning ? '文档可能包含敏感内容，请确认后继续。' : ''}本次不会包含其他画布组件。`
  );
  if (!accepted) throw new Error('已取消 AI 生成');
  await desktopGateway.confirmContextManifest(manifest.id, manifest.requiresSensitiveConfirmation);
  const result = await desktopGateway.streamChat(
    {
      requestId: crypto.randomUUID(),
      userMessageId: crypto.randomUUID(),
      assistantMessageId: crypto.randomUUID(),
      workspaceId,
      sessionId,
      providerId,
      prompt,
      contextManifestId: manifest.id,
      explanationOnly: true,
    },
    () => undefined
  );
  if (result.status !== 'complete' || !result.content.trim())
    throw new Error(result.errorMessage ?? 'AI 未返回内容');
  return {
    content: result.content,
    raw: result.content,
    sourceHash: sources.length === 1 ? sources[0].file.contentHash : undefined,
  };
}
