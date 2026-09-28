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

export type InlineEditAction =
  'polish' | 'shorten' | 'expand' | 'professional' | 'natural' | 'grammar' | 'translate' | 'custom';

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
      | { kind: 'unavailable'; reason: string }
      | { kind: 'lines'; startLine: number; endLine: number }
      | { kind: 'paragraph'; paragraph: number }
      | { kind: 'page'; page: number }
      | {
          kind: 'table_range';
          sheet: string;
          startRow: number;
          endRow: number;
          startColumn: number;
          endColumn: number;
        };
  }[];
  warnings: string[];
}
