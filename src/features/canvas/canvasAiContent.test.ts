import { describe, expect, it } from 'vitest';
import { flowchartFromOutline, readableAiContent } from './canvasAiContent';

describe('canvas AI content', () => {
  it('extracts readable Markdown from a document_patch without applying the patch', () => {
    const raw = JSON.stringify({
      version: '1.0',
      type: 'document_patch',
      workspaceId: 'workspace-1',
      changes: [
        {
          operation: 'replace',
          path: 'test.txt',
          content: '# 结构化摘要\n\n## 核心贡献\n- 已验证结论',
        },
      ],
    });
    expect(readableAiContent(raw)).toBe('# 结构化摘要\n\n## 核心贡献\n- 已验证结论');
  });

  it('turns a step outline into editable graph nodes and links', () => {
    const chart = flowchartFromOutline('1. 读取论文\n2. 分析方法\n3. 总结结论');
    expect(chart?.nodes.map((node) => node.label)).toEqual(['读取论文', '分析方法', '总结结论']);
    expect(chart?.edges).toHaveLength(2);
  });
});
