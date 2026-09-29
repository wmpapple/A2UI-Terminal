import type { SearchAuthorizedContentInput, SearchAuthorizedContentOutput } from './domain';

export interface EmbeddingConfig {
  providerId: string;
  model: string;
  revision: string;
  dimensions: number;
  location: 'local' | 'cloud';
}
export interface SemanticPlanInput {
  search: SearchAuthorizedContentInput;
  config: EmbeddingConfig;
  sourceKeys: string[] | null;
}
export interface SemanticPlan {
  id: string;
  config: EmbeddingConfig;
  endpoint: string;
  query: string;
  sources: {
    key: string;
    title: string;
    fragments: number;
    missingFragments: number;
    characters: number;
  }[];
  totalChunks: number;
  missingChunks: number;
  characters: number;
}
export interface SemanticStep {
  done: boolean;
  completed: number;
  total: number;
  result: SearchAuthorizedContentOutput | null;
  fallbackReason: string | null;
}
