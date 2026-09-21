export type DocumentTarget =
  | { kind: 'workspace_file'; workspaceId: string; sourceId: string }
  | { kind: 'result'; resultId: string };

export interface DocumentSnapshot {
  target: DocumentTarget;
  revisionId: string | null;
  contentHash: string;
  format: string;
  text: string;
  editable: boolean;
  hasUnsavedDraft: boolean;
}

export interface SelectionSnapshot {
  target: DocumentTarget;
  revisionId: string | null;
  contentHash: string;
  start: number;
  end: number;
  offsetUnit: 'utf16';
  selectedTextHash: string;
}

export interface ParsedDocument {
  format: string;
  parserVersion: string;
  rawHash: string;
  extractedHash: string;
  blocks: {
    id: string;
    text: string;
    locator:
      | { kind: 'text_range'; start: number; end: number; offsetUnit: 'utf16' }
      | { kind: 'unavailable'; reason: string };
  }[];
  warnings: string[];
}
