export interface KnowledgeSource {
  id: string;
  title: string;
  format: string;
  originalName: string;
  rawHash: string;
  extractedHash: string;
  parserVersion: string;
  sourceVersion: number;
  tags: string[];
  status: 'ready' | 'deleting' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  source: KnowledgeSource;
  parsed: { blocks: { id: string; text: string; locator: unknown }[]; warnings: string[] };
}

export interface KnowledgePage {
  items: KnowledgeSource[];
  nextCursor: number | null;
}

export interface ListKnowledgeInput {
  query?: string;
  after?: number | null;
  limit?: number;
}

export interface EditKnowledgeInput {
  id: string;
  title: string;
  tags: string[];
}
