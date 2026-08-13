import type { A2uiSurface } from '../shared/types/domain';

export const errorDetails = (error: unknown): { code: string; message: string } => {
  if (typeof error === 'object' && error && 'code' in error && 'message' in error) {
    return { code: String(error.code), message: String(error.message) };
  }
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) };
};

export const upsertA2uiSurface = (surfaces: A2uiSurface[], next: A2uiSurface): A2uiSurface[] =>
  surfaces.some((surface) => surface.surfaceId === next.surfaceId)
    ? surfaces.map((surface) => (surface.surfaceId === next.surfaceId ? next : surface))
    : [next, ...surfaces];

export const findA2uiNode = (
  node: A2uiSurface['root'],
  componentId: string
): A2uiSurface['root'] | undefined =>
  node.id === componentId
    ? node
    : node.children.map((child) => findA2uiNode(child, componentId)).find(Boolean);

export const locallyStoppedChatRequests = new Set<string>();
