import { create } from 'zustand';
import { createA2uiStore } from '../features/a2ui/a2uiStore';
import { createChatStore } from '../features/chat/chatStore';
import { createReviewStore } from '../features/diff/reviewStore';
import { createProviderStore } from '../features/settings/providerStore';
import { createWorkspaceStore } from '../features/workspace/workspaceStore';
import { mockFiles, mockSessions } from '../shared/mock/workspace';
import { getRuntimeMode } from '../shared/platform/runtime';
import type { WorkspaceFileEntry } from '../shared/types/domain';
import type { AppState } from './types';

const mockEntries: WorkspaceFileEntry[] = mockFiles.map((file) => ({
  path: file.path,
  name: file.name,
  language: file.language,
  sizeBytes: new TextEncoder().encode(file.content).length,
  readable: true,
  editable: true,
  extracted: false,
}));

const initialRuntimeMode = getRuntimeMode();
const useMockWorkspace = initialRuntimeMode === 'web-mock';
export const useAppStore = create<AppState>((set, get) => ({
  runtimeMode: initialRuntimeMode,
  workspace: null,
  recentWorkspaces: [],
  workspaceEntries: useMockWorkspace ? mockEntries : [],
  workspaceLoading: false,
  workspaceError: null,
  files: useMockWorkspace ? mockFiles : [],
  openPaths: useMockWorkspace ? ['README.md', 'src/experiment.ts'] : [],
  activePath: useMockWorkspace ? 'README.md' : '',
  dirtyPaths: [],
  saveStatusByPath: {},
  recoveryDrafts: {},
  recoveryDraftSummaries: [],
  documentVersions: [],
  versionPreview: null,
  versionHistoryPath: '',
  versionHistoryLoading: false,
  versionHistoryError: null,
  centerView: 'editor',
  sessions: useMockWorkspace ? mockSessions : [],
  activeSessionId: useMockWorkspace ? 'welcome' : '',
  pendingDiff: null,
  lastPatchApplication: null,
  patchBeforeByPath: {},
  patchApplying: false,
  patchError: null,
  selectedText: '',
  contextBySession: {},
  providerConfigs: [],
  activeProviderId: 'siliconflow',
  providerLoading: false,
  providerError: null,
  chatRequestId: null,
  chatError: null,
  a2uiSurfaces: [],
  a2uiInspections: [],
  activeSurfaceId: '',
  activeInspectionId: '',
  a2uiActionLoading: false,
  a2uiNotice: null,

  ...createWorkspaceStore(set, get),
  ...createProviderStore(set, get),
  ...createChatStore(set, get),
  ...createReviewStore(set, get),
  ...createA2uiStore(set, get),
}));
