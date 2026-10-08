import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlignLeftOutlined,
  AppstoreOutlined,
  ExpandOutlined,
  LinkOutlined,
  PlusOutlined,
  RedoOutlined,
  SearchOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import { Alert, Button, Dropdown, Input, Modal, Select, Space, Spin, Tooltip, message } from 'antd';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { resultController } from '../results/resultController';
import { sceneToolController } from '../sceneTools/sceneToolController';
import { getRuntimeMode } from '../../shared/platform/runtime';
import { renderSafeMarkdown } from '../../shared/markdown/renderSafeMarkdown';
import type {
  CanvasBinding,
  CanvasBlock,
  CanvasBlockType,
  CanvasDocument,
  CanvasEdge,
  CanvasFlowchart,
} from '../../shared/types/canvas';
import { canvasRepository } from './canvasRepository';
import { CanvasNode, type CanvasFlowNode, type CanvasNodeData } from './CanvasNode';
import { generateCanvasContent } from './generateCanvasContent';
import { readableAiContent, flowchartFromOutline } from './canvasAiContent';
import { FlowchartEditor } from './FlowchartEditor';
import { isCanvasSurface, surfaceFromLegacyMessage } from './canvasSurface';
import styles from './SpatialCanvas.module.css';

const nodeTypes = { canvasBlock: CanvasNode };
const palette: { type: CanvasBlockType; label: string; group: string; body: string }[] = [
  { type: 'note', label: '笔记', group: '基础', body: '' },
  { type: 'checklist', label: '清单', group: '基础', body: '[ ] 待办事项' },
  { type: 'flowchart', label: '流程图', group: '图解', body: '' },
  { type: 'summary', label: 'AI 摘要', group: 'AI', body: '' },
  { type: 'a2ui', label: 'A2UI 组件', group: 'AI', body: '' },
  { type: 'result', label: '成果', group: '关联', body: '' },
  { type: 'tool', label: '工具', group: '关联', body: '' },
  { type: 'action', label: '行动', group: '行动', body: '' },
  { type: 'frame', label: '分组 Frame', group: '布局', body: '' },
];
type Snapshot = { nodes: CanvasFlowNode[]; edges: Edge[] };
const clone = (value: Snapshot): Snapshot => ({
  nodes: value.nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    style: { ...node.style },
    data: { ...node.data, block: { ...node.data.block } },
  })),
  edges: value.edges.map((edge) => ({ ...edge, data: { ...edge.data } })),
});
const newBlock = (
  type: CanvasBlockType,
  position: { x: number; y: number },
  patch?: Partial<CanvasBlock>
): CanvasBlock => {
  const item = palette.find((entry) => entry.type === type);
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type,
    title: item?.label ?? '组件',
    body: item?.body ?? '',
    x: position.x,
    y: position.y,
    width:
      type === 'frame'
        ? 440
        : type === 'flowchart'
          ? 430
          : type === 'result' || type === 'tool' || type === 'a2ui'
            ? 380
            : 280,
    height:
      type === 'frame'
        ? 300
        : type === 'flowchart'
          ? 300
          : type === 'result' || type === 'tool' || type === 'a2ui'
            ? 270
            : 190,
    zIndex: type === 'frame' ? -1 : 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...patch,
  };
};
const domainEdge = (edge: Edge): CanvasEdge => ({
  id: edge.id,
  sourceBlockId: edge.source,
  targetBlockId: edge.target,
  relation: String(edge.data?.relation ?? '关联'),
  label: String(edge.label ?? ''),
});

interface Props {
  workspaceId: string;
  canvasId: string;
  onUpdated: (canvas: CanvasDocument) => void;
  onOpenFile: (path: string) => void;
  onOpenResult: (id: string) => void;
  onOpenTool: (id: string) => void;
}

function SpatialEditor({
  workspaceId,
  canvasId,
  onUpdated,
  onOpenFile,
  onOpenResult,
  onOpenTool,
}: Props) {
  const flow = useReactFlow<CanvasFlowNode, Edge>();
  const entries = useAppStore((state) => state.workspaceEntries);
  const surfaces = useAppStore((state) => state.a2uiSurfaces);
  const activePath = useAppStore((state) => state.activePath);
  const initialPath = useRef(activePath);
  const [canvas, setCanvas] = useState<CanvasDocument | null>(null);
  const [nodes, setNodes] = useState<CanvasFlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [title, setTitle] = useState('');
  const [binding, setBinding] = useState<CanvasBinding>({ type: 'none' });
  const folderFiles = useMemo(
    () =>
      binding.type === 'folder'
        ? entries
            .map((entry) => entry.path)
            .filter((path) => path.startsWith(`${binding.path}/`))
            .sort()
        : [],
    [binding, entries]
  );
  const [status, setStatus] = useState<'loading' | 'saved' | 'dirty' | 'saving' | 'error'>(
    'loading'
  );
  const [error, setError] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [placement, setPlacement] = useState<{ x: number; y: number } | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const [zoom, setZoom] = useState(1);
  const [panMode, setPanMode] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiKind, setAiKind] = useState('结构化摘要');
  const [aiSource, setAiSource] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState('');
  const [aiRawResponse, setAiRawResponse] = useState('');
  const [aiSourceHash, setAiSourceHash] = useState<string | undefined>();
  const [aiTargetBlockId, setAiTargetBlockId] = useState<string | null>(null);
  const [flowEditorOpen, setFlowEditorOpen] = useState(false);
  const [flowTargetBlockId, setFlowTargetBlockId] = useState<string | null>(null);
  const [flowPlacement, setFlowPlacement] = useState<{ x: number; y: number } | undefined>();
  const [flowInitial, setFlowInitial] = useState<CanvasFlowchart | undefined>();
  const [modal, modalHolder] = Modal.useModal();
  const [messageApi, messageHolder] = message.useMessage();
  const latest = useRef({ nodes, edges, title, binding, viewport: { x: 0, y: 0, zoom: 1 } });
  useLayoutEffect(() => {
    latest.current = { ...latest.current, nodes, edges, title, binding };
  }, [nodes, edges, title, binding]);
  const version = useRef(1);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const saving = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const history = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const onUpdatedRef = useRef(onUpdated);
  useLayoutEffect(() => {
    onUpdatedRef.current = onUpdated;
  }, [onUpdated]);
  const openSourceRef = useRef({ onOpenFile, onOpenResult, onOpenTool });
  useLayoutEffect(() => {
    openSourceRef.current = { onOpenFile, onOpenResult, onOpenTool };
  }, [onOpenFile, onOpenResult, onOpenTool]);
  const persistRef = useRef<() => Promise<void>>(async () => undefined);

  const remember = useCallback(() => {
    history.current.push(clone({ nodes: latest.current.nodes, edges: latest.current.edges }));
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    setHistoryCounts({ undo: history.current.length, redo: 0 });
  }, []);
  const persist = useCallback(async () => {
    if (saving.current || revision.current === savedRevision.current || !loaded.current) return;
    saving.current = true;
    setStatus('saving');
    const at = revision.current;
    const state = latest.current;
    const blocks: CanvasBlock[] = state.nodes.map((node) => ({
      ...node.data.block,
      x: node.position.x,
      y: node.position.y,
      width: Number(node.style?.width ?? node.data.block.width),
      height: Number(node.style?.height ?? node.data.block.height),
      parentFrameId: node.parentId,
      zIndex: node.zIndex ?? 1,
    }));
    let succeeded = false;
    try {
      const updated = await canvasRepository.save({
        workspaceId,
        id: canvasId,
        version: version.current,
        title: state.title,
        binding: state.binding,
        blocks,
        edges: state.edges.map(domainEdge),
        viewport: state.viewport,
      });
      succeeded = true;
      version.current = updated.version;
      savedRevision.current = at;
      setCanvas(updated);
      onUpdatedRef.current(updated);
      setStatus(revision.current === at ? 'saved' : 'dirty');
      setError('');
    } catch (cause) {
      setStatus('error');
      setError(String(cause));
    } finally {
      saving.current = false;
      if (succeeded && revision.current > at)
        timer.current = window.setTimeout(() => void persistRef.current(), 700);
    }
  }, [canvasId, workspaceId]);
  useLayoutEffect(() => {
    persistRef.current = persist;
  }, [persist]);
  const markDirty = useCallback(() => {
    revision.current += 1;
    setStatus('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persistRef.current(), 700);
  }, []);
  const onPatch = useCallback(
    (id: string, patch: Partial<CanvasBlock>) => {
      remember();
      setNodes((items) =>
        items.map((node) => {
          if (node.id !== id) return node;
          let surface = node.data.block.surface;
          if (node.data.block.type === 'a2ui' && typeof patch.body === 'string') {
            try {
              const parsed = JSON.parse(patch.body);
              surface = isCanvasSurface(parsed)
                ? parsed
                : surfaceFromLegacyMessage(patch.body, workspaceId);
            } catch {
              surface = undefined;
            }
          }
          return {
            ...node,
            zIndex: patch.zIndex ?? node.zIndex,
            draggable: patch.locked === undefined ? node.draggable : !patch.locked,
            data: {
              ...node.data,
              block: { ...node.data.block, ...patch, surface, updatedAt: new Date().toISOString() },
            },
          };
        })
      );
      markDirty();
    },
    [markDirty, remember, workspaceId]
  );
  const onRemove = useCallback(
    (id: string) => {
      remember();
      const removed = new Set(
        latest.current.nodes
          .filter((node) => node.id === id || node.parentId === id)
          .map((node) => node.id)
      );
      setNodes((items) => items.filter((node) => !removed.has(node.id)));
      setEdges((items) =>
        items.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
      );
      markDirty();
    },
    [markDirty, remember]
  );
  const onResize = useCallback(
    (id: string, width: number, height: number) => {
      setNodes((items) =>
        items.map((node) =>
          node.id === id
            ? {
                ...node,
                style: { ...node.style, width, height },
                data: { ...node.data, block: { ...node.data.block, width, height } },
              }
            : node
        )
      );
      markDirty();
    },
    [markDirty]
  );
  const onOpenSource = useCallback((block: CanvasBlock) => {
    if (block.sourcePath) openSourceRef.current.onOpenFile(block.sourcePath);
    else if (block.type === 'tool' && block.refId) openSourceRef.current.onOpenTool(block.refId);
    else if (block.refId) openSourceRef.current.onOpenResult(block.refId);
  }, []);
  const onRefresh = useCallback(
    async (block: CanvasBlock) => {
      if (!block.refId) return;
      try {
        if (block.type === 'tool' && getRuntimeMode() === 'desktop') {
          const view = await sceneToolController.read(block.refId);
          onPatch(block.id, {
            surface: view.surface,
            contentHash: view.stateHash,
            body: '',
            importError: undefined,
          });
          void messageApi.success('工具内容已刷新');
          return;
        }
        const document = await resultController.open(block.refId);
        if (document.result.type === 'document') throw new Error('文档不是可视化成果');
        if (document.content.length > 200_000)
          throw new Error('成果内容超过画布单组件 20 万字符限制');
        onPatch(block.id, {
          resultType: document.result.type,
          body: document.content,
          contentHash: document.contentHash,
          importError: undefined,
        });
        void messageApi.success('成果内容已刷新');
      } catch (cause) {
        onPatch(block.id, { importError: String(cause) });
        void messageApi.error(`刷新失败，已保留原快照：${String(cause)}`);
      }
    },
    [messageApi, onPatch]
  );
  const makeNode = useCallback(
    (block: CanvasBlock): CanvasFlowNode => ({
      id: block.id,
      type: 'canvasBlock',
      position: { x: block.x, y: block.y },
      parentId: block.parentFrameId,
      extent: block.parentFrameId ? 'parent' : undefined,
      draggable: !block.locked,
      dragHandle: `.${styles.dragHandle}`,
      zIndex: block.zIndex,
      style: { width: block.width, height: block.height },
      data: {
        block,
        onPatch,
        onRemove,
        onDuplicate: (id: string) => {
          const original = latest.current.nodes.find((item) => item.id === id);
          if (!original) return;
          remember();
          const copy = newBlock(
            original.data.block.type,
            { x: original.position.x + 32, y: original.position.y + 32 },
            {
              ...original.data.block,
              id: crypto.randomUUID(),
              title: `${original.data.block.title} 副本`,
              parentFrameId: undefined,
            }
          );
          setNodes((items) => [
            ...items,
            {
              ...original,
              id: copy.id,
              position: { x: copy.x, y: copy.y },
              parentId: undefined,
              extent: undefined,
              selected: false,
              data: { ...original.data, block: copy },
            },
          ]);
          markDirty();
        },
        onResize,
        onBeginChange: remember,
        onOpenSource,
        onRefresh: (block: CanvasBlock) => void onRefresh(block),
        onEditFlowchart: (block: CanvasBlock) => {
          setFlowTargetBlockId(block.id);
          setFlowInitial(
            block.flowchart ?? flowchartFromOutline(block.body) ?? { nodes: [], edges: [] }
          );
          setFlowPlacement(undefined);
          setFlowEditorOpen(true);
        },
        onLayer: (id: string, direction: 'front' | 'back') => {
          const values = latest.current.nodes.map((item) => item.zIndex ?? 1);
          onPatch(id, {
            zIndex: direction === 'front' ? Math.max(...values) + 1 : Math.min(...values) - 1,
          });
        },
        onRegenerate: (source: CanvasBlock) => {
          if (source.sourcePaths) setAiSource('@folder');
          else if (source.sourcePath) setAiSource(source.sourcePath);
          setAiKind(source.title);
          setAiTargetBlockId(source.id);
          setAiOpen(true);
        },
      } satisfies CanvasNodeData,
    }),
    [markDirty, onOpenSource, onPatch, onRefresh, onRemove, onResize, remember]
  );

  useEffect(() => {
    let active = true;
    loaded.current = false;
    void canvasRepository
      .read(workspaceId, canvasId)
      .then((loadedDoc) => {
        if (!active) return;
        setCanvas(loadedDoc);
        setTitle(loadedDoc.title);
        setBinding(loadedDoc.binding);
        version.current = loadedDoc.version;
        revision.current = 0;
        savedRevision.current = 0;
        setAiSource(
          loadedDoc.binding.type === 'file' ? loadedDoc.binding.path : initialPath.current
        );
        setNodes(loadedDoc.blocks.map(makeNode));
        setEdges(
          loadedDoc.edges.map((edge) => ({
            id: edge.id,
            source: edge.sourceBlockId,
            target: edge.targetBlockId,
            label: edge.label,
            data: { relation: edge.relation },
            type: 'smoothstep',
            animated: false,
          }))
        );
        latest.current.viewport = loadedDoc.viewport;
        setZoom(loadedDoc.viewport.zoom);
        loaded.current = true;
        setStatus('saved');
        window.requestAnimationFrame(() => flow.setViewport(loadedDoc.viewport));
      })
      .catch((cause) => {
        if (active) {
          setError(String(cause));
          setStatus('error');
        }
      });
    return () => {
      active = false;
      window.clearTimeout(timer.current);
      if (revision.current > savedRevision.current) void persistRef.current();
    };
  }, [canvasId, flow, makeNode, workspaceId]);

  const addBlock = useCallback(
    (type: CanvasBlockType, at?: { x: number; y: number }, patch?: Partial<CanvasBlock>) => {
      remember();
      const viewportCenter = flow.screenToFlowPosition({
        x:
          (canvasRef.current?.getBoundingClientRect().left ?? 0) +
          (canvasRef.current?.clientWidth ?? 800) / 2,
        y:
          (canvasRef.current?.getBoundingClientRect().top ?? 0) +
          (canvasRef.current?.clientHeight ?? 600) / 2,
      });
      const count = latest.current.nodes.length;
      const center = at ?? {
        x: viewportCenter.x - 160 + (count % 2) * 320,
        y: viewportCenter.y - 100 + Math.floor(count / 2) * 220,
      };
      const block = newBlock(type, center, patch);
      setNodes((items) => [...items, makeNode(block)]);
      markDirty();
      setPaletteOpen(false);
      setPlacement(null);
    },
    [flow, makeNode, markDirty, remember]
  );
  const createPaletteBlock = useCallback(
    async (type: CanvasBlockType, at?: { x: number; y: number }) => {
      if (type === 'flowchart') {
        setFlowTargetBlockId(null);
        setFlowInitial({ nodes: [], edges: [] });
        setFlowPlacement(at);
        setFlowEditorOpen(true);
        setPaletteOpen(false);
        return;
      }
      if (type === 'result' || type === 'tool') {
        const results = await resultController.list();
        const candidates =
          type === 'tool'
            ? getRuntimeMode() === 'desktop'
              ? await sceneToolController.list()
              : results.filter((item) => item.type === 'tool')
            : results.filter((item) =>
                ['spreadsheet', 'checklist', 'form', 'tool'].includes(item.type)
              );
        const options = candidates.map((item) => ({
          value: item.id,
          label: `${item.type === 'spreadsheet' ? '表格' : item.type === 'checklist' ? '清单' : item.type === 'form' ? '表单' : '工具'} · ${item.title}`,
          title: item.title,
        }));
        if (!options.length) {
          void messageApi.info(
            type === 'tool'
              ? '工具中暂无可导入的场景工具'
              : '当前没有可视化成果（支持 CSV、清单、表单和工具）'
          );
          return;
        }
        let id = '';
        modal.confirm({
          title: type === 'tool' ? '导入工具' : '导入可视化成果',
          content: (
            <Select
              showSearch
              style={{ width: '100%' }}
              placeholder="选择对象"
              options={options}
              onChange={(value) => {
                id = value;
              }}
            />
          ),
          okText: '添加',
          onOk: async () => {
            if (!id) {
              void messageApi.warning('请选择对象');
              return Promise.reject();
            }
            try {
              const selected = options.find((item) => item.value === id);
              if (type === 'tool' && getRuntimeMode() === 'desktop') {
                const view = await sceneToolController.read(id);
                addBlock('tool', at, {
                  refId: id,
                  title: selected?.title ?? view.result.title,
                  body: '',
                  surface: view.surface,
                  contentHash: view.stateHash,
                });
              } else {
                const document = await resultController.open(id);
                if (document.result.type === 'document')
                  throw new Error('普通文档不支持作为可视化组件');
                if (document.content.length > 200_000)
                  throw new Error('成果内容超过画布单组件 20 万字符限制');
                addBlock(type, at, {
                  refId: id,
                  title: selected?.title ?? document.result.title,
                  body: document.content,
                  resultType: document.result.type,
                  contentHash: document.contentHash,
                });
              }
            } catch (cause) {
              void messageApi.error(`导入失败：${String(cause)}`);
              return Promise.reject(cause);
            }
          },
        });
        return;
      }
      if (type === 'a2ui' && surfaces.length) {
        let id = '';
        modal.confirm({
          title: '添加已有 AI 组件',
          content: (
            <Select
              showSearch
              style={{ width: '100%' }}
              placeholder="选择 A2UI 组件"
              options={surfaces.map((surface) => ({
                value: surface.surfaceId,
                label: surface.surfaceId,
              }))}
              onChange={(value) => {
                id = value;
              }}
            />
          ),
          okText: '添加',
          onOk: () => {
            const surface = surfaces.find((item) => item.surfaceId === id);
            if (!surface) {
              void messageApi.warning('请选择组件');
              return Promise.reject();
            }
            addBlock('a2ui', at, { title: 'AI · 可视化组件', body: '', surface });
          },
        });
        return;
      }
      addBlock(
        type,
        at,
        type === 'action' ? { action: { status: 'todo', priority: 'normal' } } : undefined
      );
    },
    [addBlock, messageApi, modal, surfaces]
  );
  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
      if (
        changes.some(
          (change) =>
            change.type === 'position' || change.type === 'dimensions' || change.type === 'remove'
        )
      )
        markDirty();
    },
    [markDirty]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      setEdges((current) => applyEdgeChanges(changes, current));
      if (changes.some((change) => change.type === 'remove')) markDirty();
    },
    [markDirty]
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      remember();
      setEdges((items) =>
        addEdge(
          {
            ...connection,
            id: crypto.randomUUID(),
            type: 'smoothstep',
            label: '',
            data: { relation: '关联' },
          },
          items
        )
      );
      markDirty();
    },
    [markDirty, remember]
  );
  const editEdge = useCallback(
    (edge: Edge) => {
      let relation = String(edge.data?.relation ?? '关联');
      let label = String(edge.label ?? '');
      modal.confirm({
        title: '编辑连线',
        content: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Select
              defaultValue={relation}
              options={['关联', '支持', '反驳', '来源', '延伸', '前置', '因果', '包含'].map(
                (value) => ({ value, label: value })
              )}
              onChange={(value) => {
                relation = value;
              }}
            />
            <Input
              defaultValue={label}
              placeholder="连线标签"
              onChange={(event) => {
                label = event.target.value;
              }}
            />
          </Space>
        ),
        okText: '保存',
        cancelText: '取消',
        onOk: () => {
          remember();
          setEdges((items) =>
            items.map((item) =>
              item.id === edge.id ? { ...item, label, data: { relation } } : item
            )
          );
          markDirty();
        },
      });
    },
    [markDirty, modal, remember]
  );
  const layout = useCallback(
    (kind: 'auto' | 'horizontal' | 'vertical' | 'grid') => {
      remember();
      setNodes((items) =>
        items.map((node, index) => {
          if (node.parentId) return node;
          const x =
            kind === 'vertical'
              ? 80
              : kind === 'horizontal'
                ? index * 340 + 80
                : (index % 3) * 340 + 80;
          const y =
            kind === 'horizontal'
              ? 80
              : kind === 'vertical'
                ? index * 260 + 80
                : Math.floor(index / 3) * 260 + 80;
          return { ...node, position: { x, y } };
        })
      );
      markDirty();
      window.setTimeout(() => void flow.fitView({ padding: 0.2, duration: 300 }), 50);
    },
    [flow, markDirty, remember]
  );
  const groupSelected = useCallback(() => {
    const selected = latest.current.nodes.filter(
      (node) => node.selected && !node.parentId && node.data.block.type !== 'frame'
    );
    if (!selected.length) {
      void messageApi.info('先选中要分组的组件');
      return;
    }
    remember();
    const minX = Math.min(...selected.map((node) => node.position.x)) - 32;
    const minY = Math.min(...selected.map((node) => node.position.y)) - 64;
    const maxX =
      Math.max(...selected.map((node) => node.position.x + Number(node.style?.width ?? 280))) + 32;
    const maxY =
      Math.max(...selected.map((node) => node.position.y + Number(node.style?.height ?? 190))) + 32;
    const frame = newBlock(
      'frame',
      { x: minX, y: minY },
      { width: maxX - minX, height: maxY - minY }
    );
    setNodes((items) => [
      makeNode(frame),
      ...items.map((node) =>
        selected.some((entry) => entry.id === node.id)
          ? {
              ...node,
              parentId: frame.id,
              extent: 'parent' as const,
              position: { x: node.position.x - minX, y: node.position.y - minY },
              data: { ...node.data, block: { ...node.data.block, parentFrameId: frame.id } },
            }
          : node
      ),
    ]);
    markDirty();
  }, [makeNode, markDirty, messageApi, remember]);
  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (!previous) return;
    future.current.push(clone({ nodes: latest.current.nodes, edges: latest.current.edges }));
    setNodes(previous.nodes);
    setEdges(previous.edges);
    markDirty();
    setHistoryCounts({ undo: history.current.length, redo: future.current.length });
  }, [markDirty]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(clone({ nodes: latest.current.nodes, edges: latest.current.edges }));
    setNodes(next.nodes);
    setEdges(next.edges);
    markDirty();
    setHistoryCounts({ undo: history.current.length, redo: future.current.length });
  }, [markDirty]);
  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/a2ui-canvas-block') as CanvasBlockType;
      if (palette.some((item) => item.type === type))
        void createPaletteBlock(
          type,
          flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        );
    },
    [createPaletteBlock, flow]
  );
  const paste = useCallback(
    (event: ClipboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return;
      const value = event.clipboardData.getData('text/plain');
      if (!value.trim()) return;
      event.preventDefault();
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        const surface = isCanvasSurface(parsed)
          ? parsed
          : surfaceFromLegacyMessage(value, workspaceId);
        if (surface) {
          addBlock('a2ui', undefined, {
            title: '粘贴的 A2UI 组件',
            body: value,
            surface,
          });
          return;
        }
        if (parsed.root || parsed.protocolVersion) {
          void messageApi.error('A2UI 组件 JSON 结构无效，请检查 root、children、actions 和 data');
          return;
        }
      } catch {
        /* plain text */
      }
      addBlock('note', undefined, {
        body: value,
        title: value.split('\n')[0].slice(0, 36) || '粘贴内容',
      });
    },
    [addBlock, messageApi, workspaceId]
  );
  const generate = useCallback(async () => {
    if (!aiSource) {
      void messageApi.warning('先选择来源文件');
      return;
    }
    setAiBusy(true);
    try {
      const paths = aiSource === '@folder' ? folderFiles.slice(0, 20) : [aiSource];
      if (!paths.length) throw new Error('关联文件夹中没有可用文件');
      const result = await generateCanvasContent({
        workspaceId,
        paths,
        kind: aiKind,
        customPrompt: aiPrompt,
        confirm: async (detail) =>
          modal.confirm({
            title: '确认 AI 使用的文档',
            content: detail,
            okText: '确认生成',
            cancelText: '取消',
          }),
      });
      setAiPreview(readableAiContent(result.content));
      setAiRawResponse(result.raw);
      setAiSourceHash(result.sourceHash);
      setAiOpen(false);
    } catch (cause) {
      void messageApi.error(String(cause));
    } finally {
      setAiBusy(false);
    }
  }, [aiKind, aiPrompt, aiSource, folderFiles, messageApi, modal, workspaceId]);
  const addAiPreview = useCallback(() => {
    const isFlow = aiKind.includes('流程') || aiKind.includes('导图');
    const flowchart = isFlow ? flowchartFromOutline(aiPreview) : null;
    const patch: Partial<CanvasBlock> = {
      type: isFlow && flowchart ? 'flowchart' : 'summary',
      title: aiKind,
      body: aiPreview,
      rawAiResponse: aiRawResponse,
      flowchart: flowchart ?? undefined,
      sourcePath: aiSource === '@folder' && binding.type === 'folder' ? binding.path : aiSource,
      sourcePaths: aiSource === '@folder' ? folderFiles.slice(0, 20) : undefined,
      sourceHash: aiSourceHash,
      source: 'AI 生成',
    };
    if (aiTargetBlockId) onPatch(aiTargetBlockId, patch);
    else addBlock(isFlow && flowchart ? 'flowchart' : 'summary', undefined, patch);
    setAiPreview('');
    setAiRawResponse('');
    setAiTargetBlockId(null);
  }, [
    addBlock,
    aiKind,
    aiPreview,
    aiRawResponse,
    aiSource,
    aiSourceHash,
    aiTargetBlockId,
    binding,
    folderFiles,
    onPatch,
  ]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !canvasRef.current?.contains(document.activeElement) ||
        (event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void persistRef.current();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (event.key === ' ' && !event.repeat) setPanMode(true);
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key === ' ') setPanMode(false);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    };
  }, [redo, undo]);
  const matching = useMemo(
    () =>
      palette.filter((item) =>
        `${item.label} ${item.group}`.toLowerCase().includes(paletteQuery.toLowerCase())
      ),
    [paletteQuery]
  );
  const folderAdded =
    binding.type === 'folder'
      ? folderFiles.filter((path) => !(binding.snapshot ?? []).includes(path))
      : [];
  const folderRemoved =
    binding.type === 'folder'
      ? (binding.snapshot ?? []).filter((path) => !folderFiles.includes(path))
      : [];
  const editBinding = () => {
    let kind: 'none' | 'file' | 'folder' =
      binding.type === 'file' || binding.type === 'folder' ? binding.type : 'none';
    let path = binding.type === 'file' || binding.type === 'folder' ? binding.path : '';
    const folderPaths = Array.from(
      new Set(
        entries.flatMap((entry) => {
          const parts = entry.path.split('/');
          return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
        })
      )
    );
    modal.confirm({
      title: '关联画布',
      content: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <span>可保持独立，或关联到工作区中的文件、文件夹。</span>
          <Select
            defaultValue={kind}
            options={[
              { value: 'none', label: '独立画布' },
              { value: 'file', label: '文件' },
              { value: 'folder', label: '文件夹' },
            ]}
            onChange={(value) => {
              kind = value;
              path = '';
            }}
          />
          <Select
            showSearch
            defaultValue={path || undefined}
            placeholder="选择文件或文件夹（独立画布可留空）"
            options={[
              ...entries.map((entry) => ({ value: entry.path, label: `文件 · ${entry.path}` })),
              ...folderPaths.map((value) => ({ value, label: `文件夹 · ${value}` })),
            ]}
            onChange={(value) => {
              path = value;
            }}
          />
        </Space>
      ),
      okText: '保存关联',
      cancelText: '取消',
      onOk: () => {
        if (
          (kind === 'file' && !entries.some((entry) => entry.path === path)) ||
          (kind === 'folder' && !folderPaths.includes(path))
        ) {
          void messageApi.warning('请选择对应类型的路径');
          return Promise.reject();
        }
        setBinding(
          kind === 'none'
            ? { type: 'none' }
            : kind === 'folder'
              ? {
                  type: 'folder',
                  path,
                  snapshot: entries
                    .map((entry) => entry.path)
                    .filter((file) => file.startsWith(`${path}/`))
                    .sort(),
                }
              : { type: 'file', path }
        );
        markDirty();
      },
    });
  };
  if (status === 'loading')
    return (
      <div className={styles.loading}>
        <Spin tip="正在打开画布" />
      </div>
    );
  if (!canvas) return <Alert type="error" title={error || '无法打开画布'} />;
  return (
    <div className={styles.page} ref={canvasRef} tabIndex={0} onPaste={paste}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <Input
            aria-label="画布名称"
            value={title}
            maxLength={120}
            onChange={(event) => {
              setTitle(event.target.value);
              markDirty();
            }}
            className={styles.titleInput}
          />
          <span>
            {binding.type === 'none'
              ? '独立画布'
              : binding.type === 'result'
                ? '关联成果'
                : `${binding.type === 'file' ? '文件' : '文件夹'} · ${binding.path}`}
          </span>
          <Button size="small" type="link" onClick={editBinding}>
            关联设置
          </Button>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.saveState}>
            {status === 'saving'
              ? '保存中…'
              : status === 'dirty'
                ? '未保存'
                : status === 'error'
                  ? '保存失败'
                  : '已保存'}
          </span>
          {status === 'error' && (
            <Button size="small" onClick={() => void persist()}>
              重试
            </Button>
          )}
        </div>
      </header>
      {error && status === 'error' && (
        <Alert type="error" title={error} closable onClose={() => setError('')} />
      )}
      {binding.type === 'file' &&
        entries.length > 0 &&
        !entries.some((entry) => entry.path === binding.path) && (
          <Alert type="warning" title={`关联文件不可用：${binding.path}`} />
        )}
      {binding.type === 'folder' &&
        (binding.snapshot?.length ?? 0) > 0 &&
        folderFiles.length === 0 && (
          <Alert type="warning" title={`关联文件夹不可用或已清空：${binding.path}`} />
        )}
      {binding.type === 'folder' && (folderAdded.length > 0 || folderRemoved.length > 0) && (
        <Alert
          type="info"
          className={styles.folderChange}
          title={`目录变化：新增 ${folderAdded.length} 个文件，移除 ${folderRemoved.length} 个文件`}
          action={
            <Space>
              <Button
                size="small"
                onClick={() =>
                  modal.info({
                    title: '目录变化',
                    content: (
                      <div>
                        <p>新增：{folderAdded.join('、') || '无'}</p>
                        <p>移除：{folderRemoved.join('、') || '无'}</p>
                      </div>
                    ),
                  })
                }
              >
                查看变化
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setBinding({ type: 'folder', path: binding.path, snapshot: folderFiles });
                  markDirty();
                }}
              >
                已处理
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setAiSource('@folder');
                  setAiKind('目录概览');
                  setAiTargetBlockId(null);
                  setAiOpen(true);
                }}
              >
                AI 更新概览
              </Button>
            </Space>
          }
        />
      )}
      <div className={styles.toolbar}>
        <Space wrap size={4}>
          <Button
            size="small"
            type={!panMode ? 'primary' : 'default'}
            onClick={() => setPanMode(false)}
          >
            选择
          </Button>
          <Button
            size="small"
            type={panMode ? 'primary' : 'default'}
            onClick={() => setPanMode(true)}
          >
            平移
          </Button>
          <Button size="small" icon={<PlusOutlined />} onClick={() => setPaletteOpen(!paletteOpen)}>
            添加
          </Button>
          <Button
            size="small"
            icon={<AppstoreOutlined />}
            onClick={() => setPaletteOpen(!paletteOpen)}
          >
            组件库
          </Button>
          <Button
            size="small"
            icon={<ZoomInOutlined />}
            onClick={() => {
              setAiTargetBlockId(null);
              setAiOpen(true);
            }}
          >
            AI 生成
          </Button>
          <Tooltip title="拖动节点边缘的连接点进行连线">
            <Button size="small" icon={<LinkOutlined />}>
              连接
            </Button>
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                { key: 'auto', label: '自动整理' },
                { key: 'horizontal', label: '水平排列' },
                { key: 'vertical', label: '垂直排列' },
                { key: 'grid', label: '网格排列' },
                { key: 'group', label: '将所选组件分组' },
              ],
              onClick: ({ key }) =>
                key === 'group'
                  ? groupSelected()
                  : layout(key as 'auto' | 'horizontal' | 'vertical' | 'grid'),
            }}
          >
            <Button size="small" icon={<AlignLeftOutlined />}>
              整理布局
            </Button>
          </Dropdown>
          <Button
            size="small"
            icon={<UndoOutlined />}
            disabled={!historyCounts.undo}
            onClick={undo}
            aria-label="撤销"
          />
          <Button
            size="small"
            icon={<RedoOutlined />}
            disabled={!historyCounts.redo}
            onClick={redo}
            aria-label="重做"
          />
          <Button
            size="small"
            icon={<SearchOutlined />}
            onClick={() => setSearchOpen(!searchOpen)}
            aria-label="搜索画布"
          />
        </Space>
        <Space size={4}>
          <Button
            size="small"
            onClick={() => void flow.zoomOut()}
            icon={<ZoomOutOutlined />}
            aria-label="缩小"
          />
          <span className={styles.zoom}>{Math.round(zoom * 100)}%</span>
          <Button
            size="small"
            onClick={() => void flow.zoomIn()}
            icon={<ZoomInOutlined />}
            aria-label="放大"
          />
          <Button size="small" onClick={() => void flow.zoomTo(1)}>
            100%
          </Button>
          <Button
            size="small"
            onClick={() => void flow.fitView({ padding: 0.2, duration: 300 })}
            icon={<ExpandOutlined />}
          >
            适应内容
          </Button>
        </Space>
      </div>
      {searchOpen && (
        <div className={styles.searchBar}>
          <Input
            autoFocus
            placeholder="搜索组件标题或内容"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onPressEnter={() => {
              const match = nodes.find((node) =>
                `${node.data.block.title} ${node.data.block.body}`
                  .toLowerCase()
                  .includes(search.toLowerCase())
              );
              if (match) void flow.fitView({ nodes: [{ id: match.id }], padding: 0.6 });
            }}
          />
          <Button onClick={() => setSearchOpen(false)}>关闭</Button>
        </div>
      )}
      <div
        className={styles.flowArea}
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
        onDoubleClickCapture={(event) => {
          const target = event.target as HTMLElement;
          if (
            !target.closest('.react-flow__pane') ||
            target.closest('.react-flow__node, .react-flow__edge, button, input, textarea')
          )
            return;
          setPlacement(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          setPaletteOpen(true);
        }}
      >
        <ReactFlow<CanvasFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeDoubleClick={(_event, edge) => editEdge(edge)}
          onNodeDragStart={remember}
          onMoveEnd={(_event, viewport: Viewport) => {
            latest.current.viewport = viewport;
            setZoom(viewport.zoom);
            markDirty();
          }}
          onNodesDelete={() => markDirty()}
          panOnDrag={panMode}
          selectionOnDrag={!panMode}
          panOnScroll
          zoomOnPinch
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          zoomActivationKeyCode="Control"
          snapToGrid
          snapGrid={[16, 16]}
          minZoom={0.1}
          maxZoom={4}
          multiSelectionKeyCode="Shift"
          fitView={false}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            className={styles.minimap}
            bgColor="var(--panel)"
            nodeColor="var(--accent)"
            maskColor="rgba(0, 0, 0, 0.16)"
          />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        {!nodes.length && (
          <div className={styles.emptyHint}>双击空白处添加组件，或使用顶部「添加」开始组织思路</div>
        )}
        <Button
          className={styles.floatingAdd}
          type="primary"
          shape="circle"
          size="large"
          aria-label="添加画布组件"
          icon={<PlusOutlined />}
          onClick={() => {
            setPlacement(null);
            setPaletteOpen(true);
          }}
        />
        {paletteOpen && (
          <div className={styles.palette}>
            <div className={styles.paletteHeading}>
              <strong>添加到画布</strong>
              <Button type="text" size="small" onClick={() => setPaletteOpen(false)}>
                关闭
              </Button>
            </div>
            <Input
              autoFocus
              placeholder="搜索组件"
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
            />
            <div className={styles.paletteItems}>
              {matching.map((item) => (
                <button
                  type="button"
                  key={item.type}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/a2ui-canvas-block', item.type);
                    setPaletteOpen(false);
                  }}
                  onClick={() => void createPaletteBlock(item.type, placement ?? undefined)}
                >
                  <span>{item.label}</span>
                  <small>{item.group}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {modalHolder}
      {messageHolder}
      {flowEditorOpen && (
        <FlowchartEditor
          open={flowEditorOpen}
          value={flowInitial}
          onClose={() => setFlowEditorOpen(false)}
          onSave={(chart) => {
            if (flowTargetBlockId)
              onPatch(flowTargetBlockId, { type: 'flowchart', flowchart: chart });
            else addBlock('flowchart', flowPlacement, { title: '流程图', flowchart: chart });
            setFlowEditorOpen(false);
            setFlowTargetBlockId(null);
            setFlowPlacement(undefined);
          }}
        />
      )}
      <Modal
        title={aiTargetBlockId ? '重新生成组件' : 'AI 生成到画布'}
        open={aiOpen}
        onCancel={() => {
          setAiOpen(false);
          setAiTargetBlockId(null);
        }}
        onOk={() => void generate()}
        okText="生成预览"
        okButtonProps={{ loading: aiBusy }}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <span>仅使用明确选择的来源文件，不会发送整张画布。</span>
          <Select
            aria-label="AI 来源文件"
            showSearch
            placeholder="选择来源文件"
            value={aiSource || undefined}
            options={[
              ...(binding.type === 'folder'
                ? [{ value: '@folder', label: `整个关联文件夹（最多 20 个文件）` }]
                : []),
              ...entries
                .filter((entry) => entry.readable)
                .map((entry) => ({ value: entry.path, label: entry.path })),
            ]}
            onChange={setAiSource}
          />
          <Select
            aria-label="生成内容类型"
            value={aiKind}
            options={[
              '结构化摘要',
              '方法流程图',
              '核心贡献',
              '问题清单',
              '复现实验计划',
              '关键引用',
              '自定义',
            ].map((value) => ({ value, label: value }))}
            onChange={setAiKind}
          />
          <Input.TextArea
            aria-label="补充要求"
            placeholder="可选：告诉 AI 希望关注的内容"
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            rows={3}
          />
        </Space>
      </Modal>
      <Modal
        title="AI 生成预览"
        open={Boolean(aiPreview)}
        onCancel={() => setAiPreview('')}
        onOk={addAiPreview}
        okText="添加到画布"
        width={700}
      >
        <div
          className={styles.aiPreview}
          dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(aiPreview) }}
        />
        <div className={styles.aiPreviewLabel}>编辑生成内容</div>
        <Input.TextArea
          aria-label="AI 生成预览"
          value={aiPreview}
          onChange={(event) => setAiPreview(event.target.value)}
          rows={15}
        />
      </Modal>
    </div>
  );
}

export function CanvasPage(props: Props) {
  return (
    <ReactFlowProvider>
      <SpatialEditor {...props} />
    </ReactFlowProvider>
  );
}
