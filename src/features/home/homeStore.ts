import { create } from 'zustand';
import type {
  ResultSummary,
  RecoveryStatus,
  TaskDetail,
  TaskRunResult,
  TaskTemplate,
} from '../../shared/types/domain';
import { errorDetails } from '../../stores/support';
import { homeController } from './homeController';

interface HomeState {
  templates: TaskTemplate[];
  recentResults: ResultSummary[];
  recoveryStatus: RecoveryStatus | null;
  activeTask: TaskDetail | null;
  taskRunResult: TaskRunResult | null;
  initialized: boolean;
  loading: boolean;
  taskLoading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  beginTask: (workspaceId: string, templateId: string) => Promise<void>;
  createLocalScaffold: (answers: Record<string, unknown>) => Promise<void>;
  prepareAiTask: (answers: Record<string, unknown>) => Promise<boolean>;
  resetTask: () => void;
  clearError: () => void;
}

export const homeInitialState = {
  templates: [],
  recentResults: [],
  recoveryStatus: null,
  activeTask: null,
  taskRunResult: null,
  initialized: false,
  loading: false,
  taskLoading: false,
  error: null,
} satisfies Pick<
  HomeState,
  | 'templates'
  | 'recentResults'
  | 'recoveryStatus'
  | 'activeTask'
  | 'taskRunResult'
  | 'initialized'
  | 'loading'
  | 'taskLoading'
  | 'error'
>;

export const useHomeStore = create<HomeState>((set, get) => ({
  ...homeInitialState,

  initialize: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const [templates, recentResults, recoveryStatus] = await Promise.all([
        homeController.listTemplates(),
        homeController.listResults(),
        homeController.getRecoveryStatus(),
      ]);
      set({
        templates,
        recentResults: recentResults.slice(0, 5),
        recoveryStatus,
        initialized: true,
      });
    } catch (error) {
      set({ error: errorDetails(error).message });
    } finally {
      set({ loading: false });
    }
  },

  beginTask: async (workspaceId, templateId) => {
    set({ taskLoading: true, error: null, activeTask: null, taskRunResult: null });
    try {
      const activeTask = await homeController.createTask(workspaceId, templateId);
      set({ activeTask });
    } catch (error) {
      set({ error: errorDetails(error).message });
    } finally {
      set({ taskLoading: false });
    }
  },

  createLocalScaffold: async (answers) => {
    const current = get().activeTask;
    if (!current) return;
    set({ taskLoading: true, error: null });
    try {
      const readyTask = current.questions.length
        ? await homeController.answerTask(current.id, answers)
        : current;
      if (readyTask.status !== 'ready') {
        set({ activeTask: readyTask });
        return;
      }
      const taskRunResult = await homeController.startTask(readyTask.id);
      const recentResults = await homeController.listResults();
      set({
        activeTask: taskRunResult.task,
        taskRunResult,
        recentResults: recentResults.slice(0, 5),
      });
    } catch (error) {
      set({ error: errorDetails(error).message });
    } finally {
      set({ taskLoading: false });
    }
  },

  resetTask: () => set({ activeTask: null, taskRunResult: null, error: null }),
  prepareAiTask: async (answers) => {
    const current = get().activeTask;
    if (!current) return false;
    set({ taskLoading: true, error: null });
    try {
      const activeTask = current.questions.length
        ? await homeController.answerTask(current.id, answers)
        : current;
      set({ activeTask });
      return activeTask.status === 'ready';
    } catch (error) {
      set({ error: errorDetails(error).message });
      return false;
    } finally {
      set({ taskLoading: false });
    }
  },
  clearError: () => set({ error: null }),
}));
