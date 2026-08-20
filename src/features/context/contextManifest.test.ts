import { describe, expect, it } from 'vitest';
import type { DocumentSource, ProviderConfig } from '../../shared/types/domain';
import { buildContextManifestInput, processingLocationForProvider } from './contextManifest';

const cloudProvider: ProviderConfig = {
  id: 'openai',
  kind: 'open_ai',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt',
  temperature: 0.2,
  proxyUrl: null,
  configured: true,
  active: true,
};

describe('context manifest input', () => {
  it('carries opaque authorization references and explicit selection decisions', () => {
    const table = {
      id: 'table-source',
      workspaceId: 'workspace',
      name: 'sales.csv',
      extension: 'csv',
      kind: 'table',
      capability: 'structured_data',
      mimeType: 'text/csv',
      sizeBytes: 10,
      contentHash: 'a'.repeat(64),
      editable: false,
      warnings: [],
      table: null,
      image: null,
    } satisfies DocumentSource;
    const input = buildContextManifestInput({
      workspaceId: 'workspace',
      sessionId: 'session',
      providerId: 'openai',
      prompt: 'summarize',
      selection: {
        selection: false,
        currentFile: true,
        recentMessages: false,
        recentMessageCount: 3,
        projectFiles: [],
        documentSourceIds: ['table-source'],
      },
      files: [
        {
          path: 'notes.md',
          name: 'notes.md',
          language: 'md',
          content: 'notes',
          contentHash: 'b'.repeat(64),
          sourceId: 'text-source',
        },
        {
          path: 'excluded.md',
          name: 'excluded.md',
          language: 'md',
          content: 'UNSELECTED_BODY_MUST_NOT_CROSS_IPC',
          contentHash: 'c'.repeat(64),
          sourceId: 'excluded-source',
        },
      ],
      documentSources: [table],
      activePath: 'notes.md',
      selectedText: '',
    });
    expect(input.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'text-source', selected: true }),
        expect.objectContaining({ sourceId: 'table-source', selected: true }),
      ])
    );
    expect(JSON.stringify(input)).not.toContain('UNSELECTED_BODY_MUST_NOT_CROSS_IPC');
  });

  it('shows only explicit loopback endpoints as local processing', () => {
    expect(processingLocationForProvider(cloudProvider)).toBe('cloud');
    expect(
      processingLocationForProvider({
        ...cloudProvider,
        endpoint: 'http://localhost:11434/v1',
      })
    ).toBe('local');
  });
});
