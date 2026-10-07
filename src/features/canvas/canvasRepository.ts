import { invoke } from '@tauri-apps/api/core';
import { getRuntimeMode } from '../../shared/platform/runtime';
import type {
  CanvasBinding,
  CanvasBlock,
  CanvasDocument,
  CanvasSave,
} from '../../shared/types/canvas';
import { readableAiContent } from './canvasAiContent';
import { surfaceFromLegacyMessage } from './canvasSurface';

const key = (workspaceId: string) => `a2ui.spatial-canvases.v1.${workspaceId}`;
const now = () => new Date().toISOString();
const readMock = (workspaceId: string): CanvasDocument[] => {
  try {
    return JSON.parse(localStorage.getItem(key(workspaceId)) ?? '[]') as CanvasDocument[];
  } catch {
    return [];
  }
};
const writeMock = (workspaceId: string, canvases: CanvasDocument[]) =>
  localStorage.setItem(key(workspaceId), JSON.stringify(canvases));

// The earlier preview saved vertical cards. Give each card a stable initial position
// while retaining its content, then persist the spatial fields on the next edit.
export const normalizeCanvas = (canvas: CanvasDocument): CanvasDocument => ({
  ...canvas,
  viewport: canvas.viewport ?? { x: 0, y: 0, zoom: 1 },
  edges: canvas.edges ?? [],
  blocks: (canvas.blocks ?? []).map((block, index) => {
    const old = block as CanvasBlock & { collapsed?: boolean };
    const rawSource = (block as { source?: unknown }).source;
    const legacySource =
      rawSource && typeof rawSource === 'object' && !Array.isArray(rawSource)
        ? (rawSource as CanvasBlock['legacySource'])
        : undefined;
    const readableBody =
      old.type === 'summary' ? readableAiContent(old.body ?? '') : (old.body ?? '');
    return {
      ...old,
      type: old.type,
      title: old.title ?? '组件',
      body: readableBody,
      rawAiResponse: old.rawAiResponse ?? (readableBody !== old.body ? old.body : undefined),
      surface:
        old.surface ??
        (old.type === 'a2ui'
          ? surfaceFromLegacyMessage(old.body ?? '', canvas.workspaceId ?? '')
          : undefined),
      source:
        typeof rawSource === 'string'
          ? rawSource
          : typeof legacySource?.label === 'string'
            ? legacySource.label
            : undefined,
      legacySource: old.legacySource ?? legacySource,
      x: Number.isFinite(old.x) ? old.x : (index % 3) * 320,
      y: Number.isFinite(old.y) ? old.y : Math.floor(index / 3) * 240,
      width: Number.isFinite(old.width) ? old.width : 280,
      height: Number.isFinite(old.height) ? old.height : 190,
      zIndex: Number.isFinite(old.zIndex) ? old.zIndex : index,
    };
  }),
});

export const canvasRepository = {
  async list(workspaceId: string): Promise<CanvasDocument[]> {
    return getRuntimeMode() === 'desktop'
      ? (await invoke<CanvasDocument[]>('list_canvases', { workspaceId })).map(normalizeCanvas)
      : readMock(workspaceId).map(normalizeCanvas);
  },
  async read(workspaceId: string, id: string): Promise<CanvasDocument> {
    if (getRuntimeMode() === 'desktop')
      return normalizeCanvas(await invoke<CanvasDocument>('read_canvas', { workspaceId, id }));
    const found = readMock(workspaceId).find((item) => item.id === id);
    if (!found) throw new Error('画布不存在');
    return normalizeCanvas(found);
  },
  async create(
    workspaceId: string,
    title: string,
    binding: CanvasBinding
  ): Promise<CanvasDocument> {
    if (getRuntimeMode() === 'desktop')
      return normalizeCanvas(
        await invoke<CanvasDocument>('create_canvas', { input: { workspaceId, title, binding } })
      );
    const item: CanvasDocument = {
      id: crypto.randomUUID(),
      workspaceId,
      title,
      binding,
      version: 1,
      blocks: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: now(),
      updatedAt: now(),
    };
    writeMock(workspaceId, [item, ...readMock(workspaceId)]);
    return item;
  },
  async save(input: CanvasSave): Promise<CanvasDocument> {
    if (getRuntimeMode() === 'desktop')
      return normalizeCanvas(await invoke<CanvasDocument>('save_canvas', { input }));
    let saved: CanvasDocument | undefined;
    writeMock(
      input.workspaceId,
      readMock(input.workspaceId).map((item) => {
        if (item.id !== input.id) return item;
        if (item.version !== input.version) throw new Error('画布已在其他窗口修改');
        saved = { ...item, ...input, version: item.version + 1, updatedAt: now() };
        return saved;
      })
    );
    if (!saved) throw new Error('画布不存在');
    return saved;
  },
  async delete(workspaceId: string, id: string): Promise<void> {
    if (getRuntimeMode() === 'desktop') {
      await invoke('delete_canvas', { workspaceId, id });
      return;
    }
    writeMock(
      workspaceId,
      readMock(workspaceId).filter((item) => item.id !== id)
    );
  },
};
