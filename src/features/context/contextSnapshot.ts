import type {
  ChatMessage,
  ContextSelection,
  ContextSource,
  WorkspaceFile,
} from '../../shared/types/domain';

export interface ContextSnapshot {
  sources: ContextSource[];
  characterCount: number;
  estimatedTokens: number;
  warnings: string[];
}

export const normalizeContextSelection = (
  selection: ContextSelection,
  selectedText: string
): ContextSelection => ({
  ...selection,
  selection: selection.selection && selectedText.length > 0,
  projectFiles: selection.projectFiles.filter((path) => !isSensitivePath(path)),
});

const contentFingerprint = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
};

interface ReviewFingerprintInput {
  selection: ContextSelection;
  files: WorkspaceFile[];
  activePath: string;
  selectedText: string;
}

export const contextReviewFingerprint = ({
  selection,
  files,
  activePath,
  selectedText,
}: ReviewFingerprintInput): string => {
  const normalized = normalizeContextSelection(selection, selectedText);
  const selectedPaths = [
    ...(normalized.currentFile && activePath ? [activePath] : []),
    ...normalized.projectFiles,
  ];
  const fileVersions = [...new Set(selectedPaths)].sort().map((path) => {
    const file = files.find((item) => item.path === path);
    return [path, file?.contentHash ?? contentFingerprint(file?.content ?? '')];
  });
  return JSON.stringify({
    selection: normalized.selection,
    currentFile: normalized.currentFile,
    recentMessages: normalized.recentMessages,
    recentMessageCount: normalized.recentMessageCount,
    projectFiles: [...normalized.projectFiles].sort(),
    activePath: normalized.currentFile || normalized.selection ? activePath : '',
    selectedText: normalized.selection ? contentFingerprint(selectedText) : '',
    fileVersions,
  });
};

export const requiresContextReview = (
  reviewedFingerprint: string | undefined,
  currentFingerprint: string,
  warnings: string[]
): boolean =>
  reviewedFingerprint !== currentFingerprint ||
  warnings.some((warning) => warning.includes('possible secret'));

export const isSensitivePath = (path: string): boolean => {
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  const name = normalized.split('/').at(-1) ?? normalized;
  return (
    normalized.split('/').includes('secrets') ||
    name === '.env' ||
    name.startsWith('.env.') ||
    ['id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json'].includes(name) ||
    ['.pem', '.key', '.p12', '.pfx', '.crt', '.cer'].some((suffix) => name.endsWith(suffix))
  );
};

export const looksSensitive = (content: string): boolean => {
  const upper = content.toUpperCase();
  return [
    '-----BEGIN PRIVATE KEY-----',
    '-----BEGIN RSA PRIVATE KEY-----',
    'API_KEY=',
    'APIKEY=',
    'SECRET_KEY=',
    'ACCESS_TOKEN=',
    'AUTH_TOKEN=',
  ].some((needle) => upper.includes(needle));
};

interface SnapshotInput {
  selection: ContextSelection;
  files: WorkspaceFile[];
  activePath: string;
  selectedText: string;
  recentMessages: ChatMessage[];
  prompt: string;
}

export const buildContextSnapshot = ({
  selection,
  files,
  activePath,
  selectedText,
  recentMessages,
  prompt,
}: SnapshotInput): ContextSnapshot => {
  const sources: ContextSource[] = [];
  const warnings: string[] = [];
  const addSource = (source: ContextSource) => {
    if (isSensitivePath(source.label)) {
      warnings.push(`${source.label}: sensitive path excluded`);
      return;
    }
    if (looksSensitive(source.content)) warnings.push(`${source.label}: possible secret`);
    sources.push(source);
  };
  const active = files.find((file) => file.path === activePath);
  if (selection.selection && selectedText) {
    addSource({
      kind: 'selection',
      label: activePath,
      content: selectedText,
      baseHash: active?.contentHash,
    });
  }
  if (selection.currentFile && active) {
    addSource({
      kind: active.extracted ? 'attached_document' : 'current_file',
      label: active.path,
      content: active.content,
      baseHash: active.contentHash,
    });
  }
  for (const path of selection.projectFiles) {
    const file = files.find((item) => item.path === path);
    if (file) {
      addSource({
        kind: file.extracted ? 'attached_document' : 'project_file',
        label: file.path,
        content: file.content,
        baseHash: file.contentHash,
      });
    }
  }
  if (looksSensitive(prompt)) warnings.push('message: possible secret');
  const characterCount = sources.reduce((sum, source) => sum + source.content.length, 0);
  const historyCharacters = selection.recentMessages
    ? recentMessages
        .slice(-selection.recentMessageCount)
        .reduce((sum, message) => sum + message.content.length, 0)
    : 0;
  return {
    sources,
    characterCount,
    estimatedTokens: Math.ceil((characterCount + historyCharacters + prompt.length) / 4),
    warnings,
  };
};
