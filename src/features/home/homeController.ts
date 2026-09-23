import { knowledgeController } from '../knowledge/knowledgeController';
import { webMockHomeGateway } from '../../shared/mock/home';
import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';

const gateway = () => (isWebMock() ? webMockHomeGateway : desktopGateway);

export const homeController = {
  listTemplates: () => gateway().listTaskTemplates(),
  listResults: (workspaceId?: string) => gateway().listResults(workspaceId),
  search: async (workspaceId: string | null, query: string) => {
    const result = await gateway().searchAuthorizedContent({ workspaceId, query, limit: 20 });
    if (!isWebMock()) return result;
    const page = await knowledgeController.list({ query, limit: 20 });
    for (const source of page.items) {
      const document = await knowledgeController.get(source.id);
      result.items.push({
        id: source.id,
        kind: 'personal_knowledge',
        title: source.title,
        snippet: document.parsed.blocks
          .map((b) => b.text)
          .join('\n')
          .slice(0, 220),
        updatedAt: source.updatedAt,
        score: 1,
      });
    }
    result.items = result.items.slice(0, 20);
    return result;
  },
  rebuildSearchIndex: () => gateway().rebuildAuthorizedSearchIndex(),
  getRecoveryStatus: () => gateway().getRecoveryStatus(),
  createTask: (workspaceId: string, templateId: string) =>
    gateway().createTask(workspaceId, templateId),
  answerTask: (taskId: string, answers: Record<string, unknown>) =>
    gateway().answerTaskQuestions(taskId, answers),
  startTask: (taskId: string) => gateway().startTask(taskId),
};
