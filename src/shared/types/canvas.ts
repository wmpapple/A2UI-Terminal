import type { A2uiSurface } from './domain';
import type { ResultType } from './domain';

export interface FlowchartShape {
  id: string;
  label: string;
  shape: 'rectangle' | 'rounded' | 'diamond' | 'ellipse';
  x: number;
  y: number;
}

export interface FlowchartLink {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind?: 'arrow' | 'line';
}

export interface CanvasFlowchart {
  nodes: FlowchartShape[];
  edges: FlowchartLink[];
}

export interface CanvasNoteStyle {
  background?: string;
  textColor?: string;
  highlightColor?: string;
}

export type CanvasBinding =
  | { type: 'none' }
  | { type: 'file'; path: string }
  | { type: 'folder'; path: string; snapshot?: string[] }
  | { type: 'result'; resultId: string };

export type CanvasBlockType =
  | 'note'
  | 'quote'
  | 'summary'
  | 'diagram'
  | 'flowchart'
  | 'checklist'
  | 'tool'
  | 'file'
  | 'result'
  | 'action'
  | 'a2ui'
  | 'frame';

export interface CanvasBlock {
  id: string;
  type: CanvasBlockType;
  title: string;
  body: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  locked?: boolean;
  parentFrameId?: string;
  source?: string;
  legacySource?: {
    label?: string;
    revision?: unknown;
    locator?: unknown;
    generatedAt?: unknown;
  };
  sourceHash?: string;
  sourceRevision?: string;
  sourcePath?: string;
  sourcePaths?: string[];
  sourcePage?: number;
  refId?: string;
  resultType?: Exclude<ResultType, 'document'>;
  contentHash?: string;
  noteStyle?: CanvasNoteStyle;
  noteFormat?: 'rich';
  action?: { status: 'todo' | 'doing' | 'done'; priority: 'low' | 'normal' | 'high' };
  flowchart?: CanvasFlowchart;
  rawAiResponse?: string;
  importError?: string;
  surface?: A2uiSurface;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasEdge {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
  relation: string;
  label: string;
}

export interface CanvasDocument {
  id: string;
  workspaceId: string | null;
  title: string;
  binding: CanvasBinding;
  version: number;
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
  createdAt: string;
  updatedAt: string;
}

export type CanvasSave = Pick<
  CanvasDocument,
  'id' | 'title' | 'binding' | 'version' | 'blocks' | 'edges' | 'viewport'
> & { workspaceId: string };
