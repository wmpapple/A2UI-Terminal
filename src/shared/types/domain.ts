export type Locale = 'zh-CN' | 'en-US';
export type CenterView = 'editor' | 'diff';
export type MessageRole = 'user' | 'assistant';

export interface WorkspaceFile {
  path: string;
  name: string;
  language: string;
  content: string;
}

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
