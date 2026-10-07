import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CanvasBlock } from '../../shared/types/canvas';
import type { A2uiSurface } from '../../shared/types/domain';
import { CanvasVisualContent } from './CanvasVisualContent';

const block = (patch: Partial<CanvasBlock>): CanvasBlock => ({
  id: 'block', type: 'result', title: '导入成果', body: '', x: 0, y: 0,
  width: 380, height: 270, zIndex: 1, createdAt: '', updatedAt: '', ...patch,
});

describe('canvas visual content', () => {
  it('shows spreadsheet cells rather than only the imported title', () => {
    render(<CanvasVisualContent block={block({ resultType: 'spreadsheet', body: '月份,收入\n一月,100\n' })} />);
    expect(screen.getByRole('table').textContent).toContain('一月');
    expect(screen.getByRole('table').textContent).toContain('100');
  });

  it('shows checklist, form, and tool fields', () => {
    const { rerender } = render(<CanvasVisualContent block={block({ resultType: 'checklist', body: '{"items":[{"id":"x","text":"阅读论文","completed":true}]}' })} />);
    expect(screen.getByText('阅读论文')).toBeTruthy();
    rerender(<CanvasVisualContent block={block({ resultType: 'form', body: '{"fields":[{"id":"x","label":"论文题目","kind":"text","required":true}]}' })} />);
    expect(screen.getByText('论文题目 *')).toBeTruthy();
    rerender(<CanvasVisualContent block={block({ resultType: 'tool', body: '{"settings":[{"key":"lang","label":"语言","value":"中文"}]}' })} />);
    expect(screen.getByText('中文')).toBeTruthy();
  });

  it('renders a scene tool surface without executing actions', () => {
    const surface = {
      surfaceId: 'surface', workspaceId: 'workspace', sessionId: 'session', messageId: 'message',
      revision: 1, catalogId: null, rawMessage: '{}', events: [],
      validation: { valid: true, errors: [], warnings: [], durationMs: 0 },
      protocolVersion: 'v0.9.1', data: {},
      root: { id: 'root', component: 'Column', props: {}, actions: {}, children: [
        { id: 'text', component: 'Text', props: { text: '工具场景内容' }, actions: {}, children: [] },
      ] },
    } satisfies A2uiSurface;
    render(<CanvasVisualContent block={block({ type: 'tool', surface })} />);
    expect(screen.getByText('工具场景内容')).toBeTruthy();
  });
});
