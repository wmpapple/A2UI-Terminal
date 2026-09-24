import { beforeEach, describe, expect, it, vi } from 'vitest';
import taskFixture from '../../../contracts/v2/task.json';
import type {
  ResultDetail,
  TaskDetail,
  TaskRunResult,
  TaskTemplate,
} from '../../shared/types/domain';
import { homeController } from './homeController';
import { homeInitialState, useHomeStore } from './homeStore';

describe('home store', () => {
  const template = taskFixture.template as unknown as TaskTemplate;
  const awaiting = taskFixture.task as unknown as TaskDetail;
  const run = taskFixture.runResult as unknown as TaskRunResult;

  beforeEach(() => {
    vi.restoreAllMocks();
    useHomeStore.setState(homeInitialState);
  });

  it('loads templates and the five most recent Result summaries', async () => {
    const results = Array.from({ length: 7 }, (_, index) => ({
      ...(run.result as ResultDetail),
      id: `result-${index}`,
      title: `Result ${index}`,
    }));
    vi.spyOn(homeController, 'listTemplates').mockResolvedValue([template]);
    vi.spyOn(homeController, 'listResults').mockResolvedValue(results);

    await useHomeStore.getState().initialize();

    expect(useHomeStore.getState().templates).toEqual([template]);
    expect(useHomeStore.getState().recentResults).toHaveLength(5);
    expect(useHomeStore.getState().initialized).toBe(true);
  });

  it('routes answers and execution through the Task controller and refreshes results', async () => {
    const ready = { ...awaiting, status: 'ready' as const, questions: [] };
    vi.spyOn(homeController, 'createTask').mockResolvedValue(awaiting);
    vi.spyOn(homeController, 'answerTask').mockResolvedValue(ready);
    vi.spyOn(homeController, 'startTask').mockResolvedValue(run);
    vi.spyOn(homeController, 'listResults').mockResolvedValue([run.result]);

    await useHomeStore.getState().beginTask(awaiting.workspaceId, awaiting.templateId);
    await useHomeStore.getState().createLocalScaffold({ meetingTitle: '产品例会' });

    expect(homeController.answerTask).toHaveBeenCalledWith(awaiting.id, {
      meetingTitle: '产品例会',
    });
    expect(homeController.startTask).toHaveBeenCalledWith(awaiting.id);
    expect(useHomeStore.getState().taskRunResult).toEqual(run);
    expect(useHomeStore.getState().recentResults[0].id).toBe(run.result.id);
  });

  it('prepares AI inputs without executing the offline task or creating a result', async () => {
    const ready = { ...awaiting, status: 'ready' as const, questions: [] };
    useHomeStore.setState({ activeTask: awaiting });
    vi.spyOn(homeController, 'answerTask').mockResolvedValue(ready);
    const start = vi.spyOn(homeController, 'startTask');
    expect(await useHomeStore.getState().prepareAiTask({ meetingTitle: '产品例会' })).toBe(true);
    expect(useHomeStore.getState().activeTask).toEqual(ready);
    expect(useHomeStore.getState().taskRunResult).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it('allows an already ready AI task to retry without submitting answers twice', async () => {
    useHomeStore.setState({ activeTask: { ...awaiting, status: 'ready', questions: [] } });
    const answer = vi.spyOn(homeController, 'answerTask');
    expect(await useHomeStore.getState().prepareAiTask({})).toBe(true);
    expect(answer).not.toHaveBeenCalled();
  });
});
