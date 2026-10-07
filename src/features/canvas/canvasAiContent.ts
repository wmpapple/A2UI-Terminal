import type { CanvasFlowchart } from '../../shared/types/canvas';

const stripFence = (value: string) => value.trim().replace(/^```(?:json|markdown|md)?\s*\n?/i, '').replace(/\n?```$/, '').trim();

export function readableAiContent(raw: string): string {
  const content = stripFence(raw);
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return content;
    const record = parsed as Record<string, unknown>;
    if (record.type === 'document_patch' && Array.isArray(record.changes)) {
      const parts = record.changes
        .map((change) =>
          change && typeof change === 'object' && typeof (change as { content?: unknown }).content === 'string'
            ? (change as { content: string }).content.trim()
            : ''
        )
        .filter(Boolean);
      if (parts.length) return parts.join('\n\n---\n\n');
    }
    if (typeof record.content === 'string' && record.content.trim()) return record.content.trim();
    if (typeof record.summary === 'string' && record.summary.trim()) return record.summary.trim();
  } catch {
    return content;
  }
  return content;
}

export function flowchartFromOutline(content: string): CanvasFlowchart | null {
  const steps = content
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、)]|#{1,4})\s*/, '').trim())
    .filter((line) => line && !line.startsWith('```'))
    .slice(0, 20);
  if (steps.length < 2) return null;
  return {
    nodes: steps.map((label, index) => ({
      id: `step-${index + 1}`,
      label: label.slice(0, 120),
      shape: index === 0 || index === steps.length - 1 ? 'rounded' : 'rectangle',
      x: 80 + (index % 3) * 220,
      y: 80 + Math.floor(index / 3) * 150,
    })),
    edges: steps.slice(1).map((_, index) => ({
      id: `link-${index + 1}`,
      source: `step-${index + 1}`,
      target: `step-${index + 2}`,
    })),
  };
}
