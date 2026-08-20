import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useAppStore } from '../../../stores/useAppStore';
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
            status: 'awaiting_confirmation',
            includedSources: [
              {
                kind: 'current_file',
                label: 'notes.md',
                contentHash: 'a'.repeat(64),
                sizeBytes: 10,
                characterCount: 10,
                exclusionReason: null,
              },
            ],
            excludedSources: [
              {
                kind: 'image',
                label: 'photo.png',
                contentHash: 'b'.repeat(64),
                sizeBytes: 20,
                characterCount: 0,
                exclusionReason: '当前 Provider 合同不支持可信视觉输入；图片未发送',
              },
            ],
            characterCount: 10,
            estimatedTokens: 4,
            sensitiveWarning: false,
            requiresSensitiveConfirmation: false,
            createdAt: '1',
            expiresAt: '2',
            confirmedAt: null,
          }}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </I18nProvider>
    );
    expect(screen.getByText('云端处理')).toBeInTheDocument();
    expect(screen.getByText(/notes\.md/)).toBeInTheDocument();
    expect(
      screen.getByText(/photo\.png: 当前 Provider 合同不支持可信视觉输入/)
    ).toBeInTheDocument();
  });
});
