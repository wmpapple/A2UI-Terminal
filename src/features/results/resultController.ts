import { webMockHomeGateway } from '../../shared/mock/home';
import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';
import type {
  CreateTextResultInput,
  ExportProgressEvent,
  ExportResultInput,
} from '../../shared/types/domain';

const gateway = () => (isWebMock() ? webMockHomeGateway : desktopGateway);

export const resultController = {
  list: () => gateway().listResults(),
  create: (input: CreateTextResultInput) => gateway().createTextResult(input),
  open: (resultId: string) => gateway().readResultDocument(resultId),
  save: (resultId: string, content: string, baseHash: string) =>
    gateway().saveResultDocument(resultId, content, baseHash),
  saveDraft: (resultId: string, content: string, baseHash: string) =>
    gateway().saveResultDraft(resultId, content, baseHash),
  discardDraft: (resultId: string) => gateway().discardResultDraft(resultId),
  listRevisions: (resultId: string) => gateway().listResultRevisions(resultId),
  readRevision: (resultId: string, revisionId: string) =>
    gateway().readResultRevision(resultId, revisionId),
  restoreRevision: (resultId: string, revisionId: string, baseHash: string) =>
    gateway().restoreResultRevision(resultId, revisionId, baseHash),
  duplicate: (resultId: string) => gateway().duplicateResult(resultId),
  export: (input: ExportResultInput, onProgress: (event: ExportProgressEvent) => void) =>
    gateway().exportResult(input, onProgress),
  cancelExport: (exportId: string) => gateway().cancelExport(exportId),
};
