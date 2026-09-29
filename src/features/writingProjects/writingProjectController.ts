import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';
import { writingProjectMock } from './writingProjectMock';
import type {
  SaveProjectInput,
  SaveOutlineInput,
  PlanWritingInput,
  AcceptSectionInput,
} from '../../shared/types/writingProject';

const api = () => (isWebMock() ? writingProjectMock : desktopGateway);
const draftQueues = new Map<string, Promise<void>>();
export const writingProjectController = {
  createWorkspace: () => desktopGateway.createWritingWorkspace(),
  list: (workspaceId: string) => api().listWritingProjects(workspaceId),
  get: (projectId: string) => api().getWritingProject(projectId),
  save: (input: SaveProjectInput) => api().saveWritingProject(input),
  outline: (input: SaveOutlineInput) => api().saveWritingOutline(input),
  outlineProposal: (runId: string) => api().readWritingOutlineProposal(runId),
  plan: (input: PlanWritingInput) => api().planWritingRun(input),
  confirm: (id: string, sensitive: boolean) =>
    isWebMock()
      ? writingProjectMock.confirm(id, sensitive)
      : desktopGateway.confirmContextManifest(id, sensitive),
  start: (id: string) => api().startWritingRun(id),
  cancel: (id: string) => api().cancelWritingRun(id),
  accept: (input: AcceptSectionInput) => api().acceptWritingSection(input),
  finalize: (projectId: string, revision: number) =>
    api().finalizeWritingProject(projectId, revision),
  delete: (id: string) => api().deleteWritingProject(id),
  saveDraft(runId: string, content: string, summary: string) {
    const next = (draftQueues.get(runId) ?? Promise.resolve())
      .catch(() => {})
      .then(() => api().saveWritingDraft(runId, content, summary));
    draftQueues.set(runId, next);
    void next
      .finally(() => {
        if (draftQueues.get(runId) === next) draftQueues.delete(runId);
      })
      .catch(() => {});
    return next;
  },
};
