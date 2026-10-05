import type { ContextManifest } from './domain';
export interface ProjectConfig {
  title: string;
  goal: string;
  audience: string;
  facts: string;
  terminology: string;
  knowledgeIds: string[];
  documentSourceIds: string[];
  contextPackIds: string[];
}
export interface OutlineSection {
  id: string | null;
  title: string;
  objective: string;
  targetWords: number;
}
export interface WritingSection extends Omit<OutlineSection, 'id'> {
  id: string;
  content: string;
  summary: string;
  accepted: boolean;
  runId: string | null;
  requestId: string | null;
}
export interface WritingProject {
  id: string;
  workspaceId: string;
  revision: number;
  config: ProjectConfig;
  outlineConfirmed: boolean;
  sections: WritingSection[];
  finalReviewId: string | null;
  resultId: string | null;
  publishedRevision?: number | null;
  publishedResultHash?: string | null;
  updatedAt?: string | null;
}
export interface WritingRun {
  id: string;
  projectId: string;
  sectionId: string | null;
  projectRevision: number;
  requestId: string;
  status: 'running' | 'review' | 'accepted' | 'failed' | 'cancelled' | 'interrupted' | 'discarded';
  content: string;
  error: string | null;
  snapshot: { promptVersion: string; prompt: string; manifest: ContextManifest };
  createdAt: string;
  draft: { content: string; summary: string } | null;
}
export interface ProjectView {
  project: WritingProject;
  runs: WritingRun[];
}
export interface SaveProjectInput {
  id: string | null;
  workspaceId: string;
  revision: number | null;
  config: ProjectConfig;
}
export interface SaveOutlineInput {
  projectId: string;
  revision: number;
  sections: OutlineSection[];
  confirmed: boolean;
}
export interface PlanWritingInput {
  projectId: string;
  revision: number;
  sectionId: string | null;
  providerId: string;
  instruction: string;
}
export interface WritingPlan {
  id: string;
  requestId: string;
  manifest: ContextManifest;
  prompt: string;
}
export interface AcceptSectionInput {
  projectId: string;
  revision: number;
  sectionId: string;
  runId: string;
  content: string;
  summary: string;
}
