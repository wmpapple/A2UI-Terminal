import type { ContextManifest, ReviewRequest } from './domain';

export interface PlanGenerationInput {
  resultId: string | null;
  taskId: string | null;
  providerId: string;
  prompt: string;
  includeResult: boolean;
  knowledgeIds: string[];
  documentSourceIds: string[];
  contextPackIds: string[];
}
export interface GenerationPlan {
  id: string;
  requestId: string;
  manifest: ContextManifest;
  targetTitle: string;
  prompt: string;
}
export interface GenerationOutput {
  review: ReviewRequest;
}
