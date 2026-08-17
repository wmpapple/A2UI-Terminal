import { webMockHomeGateway } from '../../shared/mock/home';
import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';

const gateway = () => (isWebMock() ? webMockHomeGateway : desktopGateway);

export const homeController = {
  listTemplates: () => gateway().listTaskTemplates(),
  listResults: (workspaceId?: string) => gateway().listResults(workspaceId),
  createTask: (workspaceId: string, templateId: string) =>
    gateway().createTask(workspaceId, templateId),
  answerTask: (taskId: string, answers: Record<string, unknown>) =>
    gateway().answerTaskQuestions(taskId, answers),
  startTask: (taskId: string) => gateway().startTask(taskId),
};
