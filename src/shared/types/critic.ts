import type { DocumentSnapshot, SelectionSnapshot } from './document';
import type { ContextManifest } from './domain';
export interface CriticOptions {
  sentenceLimit: number;
  paragraphLimit: number;
}
export interface CriticFinding {
  id: string;
  kind: string;
  severity: string;
  start: number;
  end: number;
  line: number;
  quote: string;
  message: string;
  evidence: string | null;
  ignored: boolean;
}
export interface CriticReport {
  id: string;
  engine: 'local' | 'llm';
  engineVersion: string;
  binding: DocumentSnapshot;
  signature: string;
  profileHash: string;
  options: CriticOptions;
  findings: CriticFinding[];
  truncated: boolean;
  createdAt: string;
}
export interface CriticView {
  local: CriticReport;
  llm: CriticReport | null;
}
export interface CriticPlan {
  id: string;
  requestId: string;
  manifest: ContextManifest;
}
export interface CriticSelection {
  selection: SelectionSnapshot;
  instruction: string;
}
