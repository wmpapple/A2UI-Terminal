import type { A2uiSurface, ResultDetail, ResultSummary } from './domain';
export interface SceneToolListItem extends ResultSummary {
  bindingTitle: string | null;
  templateId: string;
  publication?: SceneToolPublication | null;
}
import type { CitationView } from './citation';
import type { CriticFinding } from './critic';
import type { DocumentTarget } from './document';
export type ToolBinding =
  | { type: 'none' }
  | { type: 'document'; target: DocumentTarget }
  | { type: 'result' | 'task' | 'workspace'; targetId: string };
export interface BindingChoice {
  binding: ToolBinding;
  title: string;
}

export interface SceneDocumentLink {
  binding: ToolBinding;
  targetTitle: string;
  boundHash: string;
  boundRevisionId: string | null;
  version: string;
  reviewedHash: string | null;
  reviewedRevisionId: string | null;
  reviewedAt: string | null;
}
export interface SceneLinkView {
  link: SceneDocumentLink | null;
  boundRevision?: { savedAt: string; source: string } | null;
  reviewedRevision?: { savedAt: string; source: string } | null;
  bindingPolicy: string;
  context: {
    scope: string;
    preview: string;
    modelAccess: boolean;
    knowledgeAccess: boolean;
  } | null;
  status: 'unbound' | 'unchecked' | 'current' | 'changed' | 'unavailable' | 'unsaved';
  currentHash: string | null;
  currentRevisionId: string | null;
  toolStateHash: string;
  citations: CitationView[];
  critics: Array<{
    engine: string;
    current: boolean;
    createdAt: string;
    findings: CriticFinding[];
    truncated: boolean;
  }>;
  evidenceError: boolean;
}
export interface SetSceneLink {
  toolResultId: string;
  binding: ToolBinding;
  expectedVersion: string | null;
}
export interface ConfirmSceneLink {
  toolResultId: string;
  version: string;
  targetHash: string;
  targetRevisionId: string | null;
  toolStateHash: string;
}

export interface SceneTemplate {
  id: string;
  name: string;
  description: string;
  itemLabel: string;
  defaultItems: string[];
  maxItems: number;
  bindingPolicy: string;
}
export interface CreateSceneTool {
  templateId: string;
  title: string;
  items: string[];
  locale: string;
}
export interface SceneToolView {
  result: ResultDetail;
  surface: A2uiSurface;
  stateHash: string;
  templateId: string;
  publication?: SceneToolPublication | null;
}
export interface SceneToolPublication {
  resultId: string;
  revisionId: string;
  title: string;
  revisionNumber: number;
  synced: boolean;
}
export interface PublishSceneTool {
  resultId: string;
  baseHash: string;
  expectedRevision: string | null;
  title?: string;
}
export interface SaveSceneTool {
  resultId: string;
  baseHash: string;
  data: Record<string, unknown>;
}
export interface RenameSceneTool {
  resultId: string;
  title: string;
}
export interface ResetSceneTool {
  resultId: string;
  baseHash: string;
}
