import { describe, expect, it } from 'vitest';
import { formatSelection } from './formatSelection';
import { renderSafeMarkdown } from '../../shared/markdown/renderSafeMarkdown';

describe('manual Markdown formatting', () => {
  it('preserves list structure across a partial multiline selection', () => {
    const source = '- 核对预算依据ddd\n- 完成审批材料';
    const result = formatSelection(source, source.indexOf('依据'), source.indexOf('料'), '**')!;
    expect(result.content).toBe('- 核对预算**依据ddd**\n- **完成审批材**料');
    expect(renderSafeMarkdown(result.content)).toContain('<strong>完成审批材</strong>料');
    expect(renderSafeMarkdown(result.content).match(/<li>/g)).toHaveLength(2);
  });
  it('retains headings, task markers, blank lines, Unicode and CRLF', () => {
    const source = '# 标题\r\n\r\n- [ ] 中文🙂  \r\n';
    const result = formatSelection(source, 0, source.length, '**')!;
    expect(result.content).toBe('# **标题**\r\n\r\n- [ ] **中文🙂**  \r\n');
    expect(formatSelection(result.content, result.start, result.end, '**')?.content).toBe(source);
  });
});
