import type { DocumentSnapshot, DocumentTarget } from './document';
export interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
}
export type DocumentNode =
  | { kind: 'paragraph' | 'quote'; runs: TextRun[] }
  | { kind: 'heading'; level: number; runs: TextRun[] }
  | { kind: 'list'; ordered: boolean; items: TextRun[][] }
  | { kind: 'table'; rows: TextRun[][][] }
  | { kind: 'image'; alt: string; source: string }
  | { kind: 'page_break' }
  | { kind: 'unsupported'; label: string };
export interface DocumentBlock {
  id: string;
  node: DocumentNode;
  source: string;
}
export interface StructuredDocument {
  schemaVersion: 1;
  blocks: DocumentBlock[];
  trailing: string;
}
export interface StructuredView {
  snapshot: DocumentSnapshot;
  document: StructuredDocument;
  warnings: string[];
}
export type StructuredOperation =
  | { op: 'replace_text'; blockId: string; text: string }
  | { op: 'replace_block'; blockId: string; markdown: string }
  | { op: 'insert_block'; afterId: string | null; markdown: string }
  | { op: 'delete_block'; blockId: string }
  | { op: 'move_block'; blockId: string; afterId: string | null }
  | { op: 'change_heading'; blockId: string; level: number }
  | { op: 'insert_table'; afterId: string | null; rows: string[][] }
  | { op: 'update_cell'; blockId: string; row: number; column: number; text: string };
export interface StructuredPatch {
  schemaVersion: 2;
  target: DocumentTarget;
  baseHash: string;
  baseRevisionId: string | null;
  operations: StructuredOperation[];
}
