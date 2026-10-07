import type { A2uiNode, A2uiSurface } from '../../shared/types/domain';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validNode = (value: unknown, depth = 0): value is A2uiNode => {
  if (!record(value) || depth > 24) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.component === 'string' &&
    record(value.props) &&
    record(value.actions) &&
    Array.isArray(value.children) &&
    value.children.every((child) => validNode(child, depth + 1))
  );
};

export const isCanvasSurface = (value: unknown): value is A2uiSurface =>
  record(value) &&
  typeof value.protocolVersion === 'string' &&
  record(value.data) &&
  validNode(value.root);

// Older canvas cards stored an A2UI v0.9 data message rather than the resolved surface.
export function surfaceFromLegacyMessage(
  raw: string,
  workspaceId: string
): A2uiSurface | undefined {
  try {
    const message: unknown = JSON.parse(raw);
    if (!record(message) || !Array.isArray(message.data)) return undefined;
    const entries = message.data.filter(record);
    const created = entries.map((entry) => entry.createSurface).find(record);
    const update = entries.map((entry) => entry.updateComponents).find(record);
    if (!created || !update || !Array.isArray(update.components) || update.components.length > 200)
      return undefined;
    const components = update.components.filter(record);
    if (components.length !== update.components.length) return undefined;
    const byId = new Map(
      components
        .filter((part) => typeof part.id === 'string')
        .map((part) => [part.id as string, part])
    );
    const build = (id: string, seen: Set<string>): A2uiNode | undefined => {
      if (seen.has(id) || seen.size > 24) return undefined;
      const part = byId.get(id);
      if (!part || typeof part.component !== 'string') return undefined;
      const next = new Set(seen).add(id);
      const childIds = Array.isArray(part.children) ? part.children : [];
      if (!childIds.every((child) => typeof child === 'string')) return undefined;
      const children = childIds.map((child) => build(child as string, next));
      if (children.some((child) => !child)) return undefined;
      return {
        id,
        component: part.component as A2uiNode['component'],
        props: record(part.props) ? part.props : {},
        actions: record(part.actions) ? (part.actions as A2uiNode['actions']) : {},
        children: children as A2uiNode[],
      };
    };
    const root = build(byId.has('root') ? 'root' : String(components[0]?.id ?? ''), new Set());
    if (!root) return undefined;
    const model = entries.map((entry) => entry.updateDataModel).find(record);
    const surface: A2uiSurface = {
      surfaceId: typeof created.surfaceId === 'string' ? created.surfaceId : crypto.randomUUID(),
      workspaceId,
      sessionId: '',
      messageId: '',
      revision: 1,
      protocolVersion: typeof entries[0]?.version === 'string' ? entries[0].version : 'v0.9.1',
      catalogId: typeof created.catalogId === 'string' ? created.catalogId : null,
      root,
      data: model && record(model.value) ? model.value : {},
      rawMessage: raw,
      validation: { valid: true, errors: [], warnings: [], durationMs: 0 },
      events: [],
    };
    return surface;
  } catch {
    return undefined;
  }
}
