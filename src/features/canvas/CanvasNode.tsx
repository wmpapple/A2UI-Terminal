import {
  DeleteOutlined,
  CopyOutlined,
  EditOutlined,
  LockOutlined,
  UnlockOutlined,
  LinkOutlined,
  ReloadOutlined,
  MoreOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { Button, Dropdown, Input, Select, Tooltip } from 'antd';
import { memo, useEffect, useState, type CSSProperties } from 'react';
import type { CanvasBlock } from '../../shared/types/canvas';
import { useAppStore } from '../../stores/useAppStore';
import { CanvasVisualContent } from './CanvasVisualContent';
import { FlowchartPreview } from './FlowchartPreview';
import { RichNoteEditor } from './RichNoteEditor';
import { noteHtml } from './richNoteHtml';
import styles from './SpatialCanvas.module.css';

export interface CanvasNodeData extends Record<string, unknown> {
  block: CanvasBlock;
  onPatch: (id: string, patch: Partial<CanvasBlock>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onResize: (id: string, width: number, height: number) => void;
  onBeginChange: () => void;
  onOpenSource: (block: CanvasBlock) => void;
  onRegenerate: (block: CanvasBlock) => void;
  onLayer: (id: string, direction: 'front' | 'back') => void;
  onEditFlowchart: (block: CanvasBlock) => void;
  onRefresh: (block: CanvasBlock) => void;
}
export type CanvasFlowNode = Node<CanvasNodeData, 'canvasBlock'>;

const labels: Record<CanvasBlock['type'], string> = {
  note: '笔记',
  quote: '引用',
  summary: 'AI 摘要',
  diagram: '流程图',
  flowchart: '流程图',
  checklist: '清单',
  tool: '场景工具',
  file: '文件',
  result: '成果',
  action: '行动',
  a2ui: 'A2UI 组件',
  frame: '分组',
};

function Diagram({ source }: { source: string }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const hasMermaidHeader =
    /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|timeline|journey|gitGraph|quadrantChart|xychart|sankey|block|architecture|packet|kanban|treemap)\b/i.test(
      source.trimStart()
    );
  useEffect(() => {
    let alive = true;
    if (!source.trim() || !hasMermaidHeader) return;
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
        const rendered = await mermaid.render(
          `canvas-diagram-${crypto.randomUUID().replaceAll('-', '')}`,
          source
        );
        if (alive) {
          setSvg(rendered.svg);
          setError('');
        }
      })
      .catch((cause) => {
        if (alive) {
          setSvg('');
          setError(String(cause));
        }
      });
    return () => {
      alive = false;
    };
  }, [hasMermaidHeader, source]);
  if (!source.trim()) return <span>输入 Mermaid 语法以预览</span>;
  if (!hasMermaidHeader) return <span className={styles.expandedText}>{source}</span>;
  if (error) return <span className={styles.diagramError}>图解语法错误：{error}</span>;
  return svg ? (
    <iframe title="流程图预览" sandbox="" srcDoc={svg} className={styles.diagramFrame} />
  ) : (
    <span>输入 Mermaid 语法以预览</span>
  );
}

function NoteBody({ block }: { block: CanvasBlock }) {
  return (
    <div
      className={styles.noteText}
      dangerouslySetInnerHTML={{ __html: block.body ? noteHtml(block) : '点击写笔记' }}
    />
  );
}

function CanvasNodeComponent({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const { block } = data;
  const currentHash = useAppStore(
    (state) => state.files.find((file) => file.path === block.sourcePath)?.contentHash
  );
  const workspaceEntries = useAppStore((state) => state.workspaceEntries);
  const currentFolderPaths =
    block.sourcePaths && block.sourcePath
      ? workspaceEntries
          .map((entry) => entry.path)
          .filter((path) => path.startsWith(`${block.sourcePath}/`))
          .sort()
          .slice(0, 20)
      : undefined;
  const stale = block.sourcePaths
    ? JSON.stringify(block.sourcePaths) !== JSON.stringify(currentFolderPaths)
    : Boolean(block.sourceHash && currentHash && block.sourceHash !== currentHash);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isFrame = block.type === 'frame';
  const canOpen = !block.sourcePaths && Boolean(block.sourcePath || block.refId);
  const body =
    block.type === 'checklist' ? (
      <div className={styles.checklist}>
        <div className={styles.progress}>
          {block.body.split('\n').filter((line) => line.startsWith('[x]')).length} /{' '}
          {block.body.split('\n').filter(Boolean).length} 已完成
        </div>
        {block.body.split('\n').map((line, index) =>
          line ? (
            <label key={index} className={styles.checkItem}>
              <input
                type="checkbox"
                className="nodrag"
                checked={line.startsWith('[x]')}
                onChange={(event) => {
                  const lines = block.body.split('\n');
                  lines[index] =
                    `[${event.target.checked ? 'x' : ' '}] ${line.replace(/^\[[ x]\]\s*/i, '')}`;
                  data.onPatch(id, { body: lines.join('\n') });
                }}
              />
              {line.replace(/^\[[ x]\]\s*/i, '')}
            </label>
          ) : null
        )}
      </div>
    ) : block.type === 'diagram' ? (
      <Diagram source={block.body} />
    ) : block.type === 'flowchart' ? (
      <FlowchartPreview chart={block.flowchart ?? { nodes: [], edges: [] }} />
    ) : ['a2ui', 'result', 'tool', 'summary'].includes(block.type) ? (
      <CanvasVisualContent block={block} />
    ) : block.type === 'note' ? (
      <NoteBody block={block} />
    ) : block.type === 'action' ? (
      <div className={styles.actionBody}>
        <span className={styles.actionState} data-status={block.action?.status || 'todo'}>
          {block.action?.status === 'done'
            ? '✓ 已完成'
            : block.action?.status === 'doing'
              ? '◉ 进行中'
              : '○ 待开始'}
        </span>
        <span className={styles.actionPriority}>
          {block.action?.priority === 'high'
            ? '高优先级'
            : block.action?.priority === 'low'
              ? '低优先级'
              : '普通优先级'}
        </span>
        <p>{block.body || '双击添加行动说明'}</p>
      </div>
    ) : (
      <span className={expanded ? styles.expandedText : styles.previewText}>
        {block.body || '双击编辑内容'}
      </span>
    );
  return (
    <div
      className={`${styles.node} ${isFrame ? styles.frameNode : ''} ${selected ? styles.selectedNode : ''}`}
      data-kind={block.type}
      data-testid={`canvas-node-${id}`}
      style={
        {
          '--note-bg': block.noteStyle?.background,
          '--note-text': block.noteStyle?.textColor,
        } as CSSProperties
      }
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (block.type === 'flowchart') data.onEditFlowchart(block);
        else setEditing(true);
      }}
    >
      <NodeResizer
        isVisible={selected && !block.locked}
        minWidth={isFrame ? 280 : 160}
        minHeight={isFrame ? 180 : 110}
        onResizeStart={data.onBeginChange}
        onResizeEnd={(_event, params) => data.onResize(id, params.width, params.height)}
      />
      {!isFrame && (
        <>
          <Handle type="target" position={Position.Left} />
          <Handle type="source" position={Position.Right} />
        </>
      )}
      <div className={`${styles.nodeHeading} ${styles.dragHandle}`}>
        <span className={styles.nodeKind}>{labels[block.type]}</span>
        <strong title={block.title}>{block.title}</strong>
        <div className={`${styles.nodeActions} nodrag`}>
          <Tooltip title="编辑">
            <Button
              size="small"
              type="text"
              aria-label="编辑组件"
              icon={<EditOutlined />}
              onClick={() =>
                block.type === 'flowchart'
                  ? data.onEditFlowchart(block)
                  : setEditing((value) => !value)
              }
            />
          </Tooltip>
          <Tooltip title="复制">
            <Button
              size="small"
              type="text"
              aria-label="复制组件"
              icon={<CopyOutlined />}
              onClick={() => data.onDuplicate(id)}
            />
          </Tooltip>
          {(block.type === 'result' || block.type === 'tool') && block.refId && (
            <Tooltip title="刷新源内容快照">
              <Button
                size="small"
                type="text"
                aria-label="刷新内容"
                icon={<SyncOutlined />}
                onClick={() => data.onRefresh(block)}
              />
            </Tooltip>
          )}
          <Dropdown
            menu={{
              items: [
                { key: 'front', label: '置于顶层' },
                { key: 'back', label: '置于底层' },
              ],
              onClick: ({ key }) => data.onLayer(id, key as 'front' | 'back'),
            }}
          >
            <Button size="small" type="text" aria-label="组件层级" icon={<MoreOutlined />} />
          </Dropdown>
          <Tooltip title={block.locked ? '解锁' : '锁定'}>
            <Button
              size="small"
              type="text"
              aria-label={block.locked ? '解锁组件' : '锁定组件'}
              icon={block.locked ? <LockOutlined /> : <UnlockOutlined />}
              onClick={() => data.onPatch(id, { locked: !block.locked })}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button
              size="small"
              type="text"
              danger
              aria-label="删除组件"
              icon={<DeleteOutlined />}
              onClick={() => data.onRemove(id)}
            />
          </Tooltip>
        </div>
      </div>
      {editing ? (
        <div className={`${styles.nodeEditor} nodrag nowheel`}>
          <Input
            aria-label="组件标题"
            value={block.title}
            maxLength={120}
            onChange={(event) => data.onPatch(id, { title: event.target.value })}
          />
          {block.type === 'note' ? (
            <RichNoteEditor
              block={block}
              onPatch={(patch) => data.onPatch(id, patch)}
              onDone={() => setEditing(false)}
            />
          ) : (
            <Input.TextArea
              style={
                ['result', 'tool', 'a2ui'].includes(block.type) ? { display: 'none' } : undefined
              }
              aria-label="组件内容"
              maxLength={200000}
              autoSize={{ minRows: 2, maxRows: 4 }}
              value={block.body}
              onChange={(event) => data.onPatch(id, { body: event.target.value })}
              placeholder="输入文字或粘贴内容"
            />
          )}
          {['result', 'tool', 'a2ui'].includes(block.type) && (
            <span className={styles.readonlyHint}>
              可视化内容来自导入快照。点击刷新内容同步来源。
            </span>
          )}
          {block.type === 'diagram' && (
            <Button
              size="small"
              onClick={() => {
                setEditing(false);
                data.onEditFlowchart(block);
              }}
            >
              用图形编辑器重绘
            </Button>
          )}
          {block.type === 'action' && (
            <div className={styles.actionTools}>
              <Select
                aria-label="行动状态"
                value={block.action?.status || 'todo'}
                options={[
                  { value: 'todo', label: '待开始' },
                  { value: 'doing', label: '进行中' },
                  { value: 'done', label: '已完成' },
                ]}
                onChange={(status) =>
                  data.onPatch(id, {
                    action: { status, priority: block.action?.priority || 'normal' },
                  })
                }
              />
              <Select
                aria-label="行动优先级"
                value={block.action?.priority || 'normal'}
                options={[
                  { value: 'low', label: '低优先级' },
                  { value: 'normal', label: '普通' },
                  { value: 'high', label: '高优先级' },
                ]}
                onChange={(priority) =>
                  data.onPatch(id, { action: { priority, status: block.action?.status || 'todo' } })
                }
              />
            </div>
          )}
          {block.type !== 'note' && (
            <Button size="small" aria-label="完成编辑" onClick={() => setEditing(false)}>
              完成
            </Button>
          )}
        </div>
      ) : (
        !isFrame && (
          <div
            className={styles.nodeBody}
            onClick={
              block.type === 'note'
                ? (event) => {
                    event.stopPropagation();
                    setEditing(true);
                  }
                : undefined
            }
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (block.type === 'flowchart') data.onEditFlowchart(block);
              else setEditing(true);
            }}
          >
            {body}
          </div>
        )
      )}
      {!editing && block.body.length > 220 && block.type !== 'diagram' && (
        <Button className="nodrag" size="small" type="link" onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起' : '展开'}
        </Button>
      )}
      {canOpen && (
        <Button
          className={`${styles.sourceLink} nodrag`}
          size="small"
          type="link"
          icon={<LinkOutlined />}
          onClick={() => data.onOpenSource(block)}
        >
          {block.sourcePath
            ? `${block.sourcePath}${block.sourcePage ? ` · P${block.sourcePage}` : ''}`
            : '打开关联对象'}
        </Button>
      )}
      {stale && (
        <div className={styles.stale}>
          ⚠ 来源已更新{' '}
          <Button
            size="small"
            type="link"
            icon={<ReloadOutlined />}
            onClick={() => data.onRegenerate(block)}
          >
            重新生成
          </Button>
        </div>
      )}
      {block.importError && (
        <div className={styles.stale} role="status">
          ⚠ {block.importError}
        </div>
      )}
      {!stale && block.source && <span className={styles.sourceStatus}>{block.source}</span>}
    </div>
  );
}

export const CanvasNode = memo(CanvasNodeComponent);
