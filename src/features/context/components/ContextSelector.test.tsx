import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useAppStore } from '../../../stores/useAppStore';
import { useImportStore } from '../../imports/importStore';
import { ContextSelector } from './ContextSelector';

const initialSelection = {
  selection: false,
  currentFile: true,
  recentMessages: true,
  recentMessageCount: 3,
  projectFiles: [],
};

describe('ContextSelector', () => {
  it('shows the captured editor selection length', () => {
    useAppStore.setState({ selectedText: 'selected text' });
    render(
      <I18nProvider>
        <ContextSelector
          open
          prompt="test"
          initialSelection={initialSelection}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </I18nProvider>
    );
    expect(screen.getByText('13 chars')).toBeInTheDocument();
  });

  it('disables selection context when no editor text is selected', () => {
    useAppStore.setState({ selectedText: '' });
    render(
      <I18nProvider>
        <ContextSelector
          open
          prompt="test"
          initialSelection={initialSelection}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </I18nProvider>
    );
    expect(screen.getByRole('checkbox', { name: /当前选区/ })).toBeDisabled();
  });

  it('shows the Rust manifest, processing location, and excluded reasons before send', () => {
    useAppStore.setState({ selectedText: '' });
    const clearIndex = vi.fn();
    render(
      <I18nProvider>
        <ContextSelector
          open
          prompt="test"
          initialSelection={initialSelection}
          processingLocation="cloud"
          manifest={{
            id: 'manifest',
            workspaceId: 'workspace',
            sessionId: 'session',
            providerId: 'openai',
            processingLocation: 'cloud',
            strategy: 'retrieval',
            indexMode: 'memory_lexical',
            status: 'awaiting_confirmation',
            includedSources: [
              {
                kind: 'current_file',
                label: 'notes.md',
                sourceRef: 'source-notes',
                contentHash: 'a'.repeat(64),
                sizeBytes: 10,
                characterCount: 10,
                mode: 'retrieved',
                selectedRanges: [{ chunkId: 'chunk-0001', startCharacter: 0, endCharacter: 10 }],
                exclusionReason: null,
              },
            ],
            excludedSources: [
              {
                kind: 'image',
                label: 'photo.png',
                sourceRef: 'source-photo',
                contentHash: 'b'.repeat(64),
                sizeBytes: 20,
                characterCount: 0,
                mode: 'excluded',
                selectedRanges: [],
                exclusionReason: '当前 Provider 合同不支持可信视觉输入；图片未发送',
              },
            ],
            characterCount: 10,
            estimatedTokens: 4,
            tokenBudget: 32000,
            retrievedChunkCount: 1,
            sensitiveWarning: false,
            requiresSensitiveConfirmation: false,
            createdAt: '1',
            expiresAt: '2',
            confirmedAt: null,
          }}
          onCancel={() => undefined}
          onClearIndex={clearIndex}
          onConfirm={() => undefined}
        />
      </I18nProvider>
    );
    expect(screen.getByText('云端处理')).toBeInTheDocument();
    expect(screen.getByText('检索策略：只发送与问题相关的分块')).toBeInTheDocument();
    expect(screen.getByText(/本机内存检索选中 1 个分块/)).toBeInTheDocument();
    expect(screen.getAllByText(/notes\.md/)).toHaveLength(2);
    expect(screen.getByText('chunk-0001 [0–10]')).toBeInTheDocument();
    expect(
      screen.getByText(/photo\.png: 当前 Provider 合同不支持可信视觉输入/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除本工作区检索索引' }));
    expect(clearIndex).toHaveBeenCalledTimes(1);
  });

  it('shows an explicitly selected authorized source in the preflight list', () => {
    useAppStore.setState({
      workspace: { id: 'workspace', name: 'Fixture', available: true, kind: 'directory' },
      activePath: 'selected/current/PROJECT_GUIDE.md',
      selectedText: '',
      files: [
        {
          path: 'selected/current/PROJECT_GUIDE.md',
          name: 'PROJECT_GUIDE.md',
          language: 'markdown',
          content: '1111',
          sourceId: 'current-source',
        },
        {
          path: 'selected/long/long.md',
          name: 'long.md',
          language: 'markdown',
          content: 'long content',
          sourceId: 'long-source',
        },
      ],
    });
    useImportStore.setState({
      sources: [
        {
          id: 'current-source',
          workspaceId: 'workspace',
          name: 'PROJECT_GUIDE.md',
          extension: 'md',
          kind: 'text',
          capability: 'editable_text',
          mimeType: 'text/markdown',
          sizeBytes: 4,
          contentHash: 'a'.repeat(64),
          editable: true,
          warnings: [],
          table: null,
          image: null,
        },
        {
          id: 'long-source',
          workspaceId: 'workspace',
          name: 'long.md',
          extension: 'md',
          kind: 'text',
          capability: 'editable_text',
          mimeType: 'text/markdown',
          sizeBytes: 30000,
          contentHash: 'b'.repeat(64),
          editable: true,
          warnings: [],
          table: null,
          image: null,
        },
      ],
    });

    render(
      <I18nProvider>
        <ContextSelector
          open
          prompt="火星预算批准"
          initialSelection={{
            ...initialSelection,
            documentSourceIds: ['current-source', 'long-source'],
          }}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </I18nProvider>
    );

    expect(screen.getAllByText('long.md')).toHaveLength(2);
  });
});
