import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';
import type {
  SaveWritingProfileInput,
  TerminologyRule,
  WritingProfile,
  WritingProfileBundle,
  WritingProfileScope,
  WritingProfileSnapshot,
} from '../../shared/types/domain';
import { contentFingerprint } from '../context/contextSnapshot';

const globalProfile = (): WritingProfile => ({
  id: 'global',
  scope: 'global',
  workspaceId: null,
  enabled: false,
  version: 1,
  rules: '',
  terminology: [],
  forbiddenWords: [],
  exampleKnowledgeIds: [],
  updatedAt: new Date(0).toISOString(),
});

let mockGlobal = globalProfile();
const mockWorkspaces = new Map<string, WritingProfile>();

export const buildWritingProfileSnapshot = (
  global: WritingProfile,
  workspace: WritingProfile | null
): WritingProfileSnapshot => {
  const active = [global, workspace].filter((profile): profile is WritingProfile =>
    Boolean(profile?.enabled)
  );
  const terms = new Map<string, TerminologyRule>();
  const forbidden = new Map<string, string>();
  const examples: string[] = [];
  active.forEach((profile) => {
    profile.terminology.forEach((rule) => terms.set(rule.term.toLocaleLowerCase(), rule));
    profile.forbiddenWords.forEach((word) => forbidden.set(word.toLocaleLowerCase(), word));
    profile.exampleKnowledgeIds.forEach((id) => {
      if (!examples.includes(id)) examples.push(id);
    });
  });
  const layers = active.map(({ id, scope, version, rules }) => ({
    id,
    scope,
    version,
    rules: rules.trim(),
  }));
  const terminology = [...terms.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, rule]) => rule);
  const forbiddenWords = [...forbidden.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, word]) => word);
  const instructionLines: string[] = [];
  layers.forEach((layer) => {
    instructionLines.push(`${layer.scope === 'global' ? 'Global Profile' : 'Workspace Profile'}:`);
    if (layer.rules) instructionLines.push(`- Rules: ${layer.rules}`);
  });
  if (terminology.length) {
    instructionLines.push('- Preferred terminology:');
    terminology.forEach((rule) => instructionLines.push(`  - ${rule.term} => ${rule.preferred}`));
  }
  if (forbiddenWords.length) {
    instructionLines.push(
      `- Avoid these words unless the current instruction explicitly requires them: ${forbiddenWords.join(', ')}`
    );
  }
  const instructionText = instructionLines.join('\n').trim();
  const estimatedTokens = Math.ceil(
    [...instructionText].reduce(
      (sum, character) => sum + (character.charCodeAt(0) <= 127 ? 1 : 8),
      0
    ) / 4
  );
  return {
    hash: contentFingerprint(
      JSON.stringify(['m2.1', layers, terminology, forbiddenWords, examples])
    ),
    composerVersion: 'm2.1',
    enabled: active.length > 0,
    layers,
    terminology,
    forbiddenWords,
    exampleKnowledgeIds: examples,
    instructionText,
    estimatedTokens,
  };
};

const mockBundle = (workspaceId?: string): WritingProfileBundle => {
  const workspace = workspaceId ? (mockWorkspaces.get(workspaceId) ?? null) : null;
  return {
    global: mockGlobal,
    workspace,
    effective: buildWritingProfileSnapshot(mockGlobal, workspace),
  };
};

export const writingProfileController = {
  async get(workspaceId?: string): Promise<WritingProfileBundle> {
    if (!isWebMock()) return desktopGateway.getWritingProfiles(workspaceId);
    return mockBundle(workspaceId);
  },
  async save(input: SaveWritingProfileInput): Promise<WritingProfileBundle> {
    if (!isWebMock()) return desktopGateway.saveWritingProfile(input);
    const previous =
      input.scope === 'global'
        ? mockGlobal
        : input.workspaceId
          ? mockWorkspaces.get(input.workspaceId)
          : undefined;
    const profile: WritingProfile = {
      id: input.scope === 'global' ? 'global' : `workspace:${input.workspaceId}`,
      ...input,
      version: (previous?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    if (input.scope === 'global') mockGlobal = profile;
    else if (input.workspaceId) mockWorkspaces.set(input.workspaceId, profile);
    return mockBundle(input.workspaceId ?? undefined);
  },
  async delete(scope: WritingProfileScope, workspaceId?: string): Promise<WritingProfileBundle> {
    if (!isWebMock()) return desktopGateway.deleteWritingProfile(scope, workspaceId);
    if (scope === 'global') mockGlobal = { ...globalProfile(), version: mockGlobal.version + 1 };
    else if (workspaceId) mockWorkspaces.delete(workspaceId);
    return mockBundle(workspaceId);
  },
};
