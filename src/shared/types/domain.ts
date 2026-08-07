export type Locale = 'zh-CN' | 'en-US';
export type CenterView = 'editor' | 'diff';
export type MessageRole = 'user' | 'assistant';
export type ProviderKind = 'silicon_flow' | 'deep_seek' | 'open_ai' | 'custom';

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
  kind: 'directory' | 'standalone';
}

export interface SelectedWorkspaceFiles {
  workspace: WorkspaceSummary;
  documents: WorkspaceDocument[];
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
  status?: 'streaming' | 'complete' | 'stopped' | 'error';
  requestId?: string | null;
  providerId?: string | null;
  errorCode?: string | null;
  createdAt?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  workspaceId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  endpoint: string;
  model: string;
  temperature: number;
  proxyUrl: string | null;
  configured: boolean;
  active: boolean;
}

export type ContextSourceKind = 'selection' | 'current_file' | 'project_file' | 'attached_document';

export interface ContextSource {
  kind: ContextSourceKind;
  label: string;
  content: string;
}

export interface ChatRequest {
  requestId: string;
  userMessageId: string;
  assistantMessageId: string;
  workspaceId: string;
  sessionId: string;
  providerId: string;
  prompt: string;
  recentMessageCount: number;
  contextSources: ContextSource[];
  sensitiveConfirmed: boolean;
}

export type ChatStreamEvent =
  | { type: 'delta'; requestId: string; messageId: string; delta: string }
  | { type: 'complete'; requestId: string; messageId: string }
  | { type: 'stopped'; requestId: string; messageId: string }
  | {
      type: 'error';
      requestId: string;
      messageId: string;
      code: string;
      message: string;
    };

export interface ChatStreamResult {
  requestId: string;
  messageId: string;
  content: string;
  status: 'complete' | 'stopped' | 'error';
  errorCode: string | null;
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
