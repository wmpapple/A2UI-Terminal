export type Locale = 'zh-CN' | 'en-US';
export type CenterView = 'editor' | 'diff';
export type MessageRole = 'user' | 'assistant';

export interface WorkspaceFile {
  path: string;
  name: string;
  language: string;
  content: string;
  contentHash?: string;
  sizeBytes?: number;
  editable?: boolean;
  extracted?: boolean;
  sourceId?: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  available: boolean;
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  language: string;
  sizeBytes: number;
  readable: boolean;
  editable: boolean;
  extracted: boolean;
  sourceId?: string;
}

export interface WorkspaceDraft {
  content: string;
  baseHash: string;
  updatedAt: string;
}

export interface WorkspaceDocument extends WorkspaceFile {
  contentHash: string;
  sizeBytes: number;
  draft: WorkspaceDraft | null;
  editable: boolean;
  extracted: boolean;
}

export type FileSaveStatus = 'saved' | 'dirty' | 'draft' | 'saving' | 'conflict' | 'error';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  status?: 'streaming' | 'complete' | 'stopped';
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
}

export interface ContextSelection {
  selection: boolean;
  currentFile: boolean;
  recentMessages: boolean;
  recentMessageCount: number;
  projectFiles: string[];
}

export interface DiffProposal {
  id: string;
  path: string;
  reason: string;
  risk: 'low' | 'medium' | 'high';
  before: string;
  after: string;
  accepted: boolean;
}
