import type { ParsedDocument } from './document';
export type CitationLocator = ParsedDocument['blocks'][number]['locator'];
export interface CitationView {
  key: string;
  title: string;
  locator: CitationLocator | null;
  status: 'verified' | 'unknown' | 'stale' | 'unauthorized' | 'unavailable';
  excerpt: string | null;
}
export interface UpgradeProgress {
  pending: number;
  completed: number;
  failed: number;
  errors: string[];
}
