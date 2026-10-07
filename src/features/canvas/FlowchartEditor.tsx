import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { Button, Input, Modal, Segmented, Space } from 'antd';
import { useCallback, useState } from 'react';
import type { CanvasFlowchart, FlowchartLink, FlowchartShape } from '../../shared/types/canvas';
import styles from './FlowchartEditor.module.css';

type ShapeNode = Node<
  { label: string; shape: FlowchartShape['shape']; onLabel: (id: string, label: string) => void },
  'shape'
>;

function Shape({ id, data }: NodeProps<ShapeNode>) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      className={styles.shape}
      data-shape={data.shape}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      <Handle type="target" position={Position.Left} />
      {editing ? (
        <Input
          autoFocus
          className="nodrag"
          aria-label="流程节点文字"
          value={data.label}
          maxLength={120}
          onChange={(event) => data.onLabel(id, event.target.value)}
          onPressEnter={() => setEditing(false)}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <span>{data.label}</span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { shape: Shape };
type ConnectorKind = NonNullable<FlowchartLink['kind']>;
const edgeStyle = (kind: ConnectorKind) => ({
  markerEnd:
    kind === 'arrow'
      ? { type: MarkerType.ArrowClosed, color: '#6c8bc7', width: 20, height: 20 }
      : undefined,
  data: { kind },
});

export function FlowchartEditor({
  open,
  value,
  onSave,
  onClose,
}: {
  open: boolean;
  value?: CanvasFlowchart;
  onSave: (value: CanvasFlowchart) => void;
  onClose: () => void;
}) {
  const [nodes, setNodes] = useState<ShapeNode[]>(() =>
    (value?.nodes ?? []).map((node) => ({
      id: node.id,
      type: 'shape',
      position: { x: node.x, y: node.y },
      data: { label: node.label, shape: node.shape, onLabel: () => undefined },
    }))
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    (value?.edges ?? []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: 'smoothstep',
      ...edgeStyle(edge.kind ?? 'arrow'),
    }))
  );
  const [connectorKind, setConnectorKind] = useState<ConnectorKind>('arrow');
  const setLabel = useCallback((id: string, label: string) => {
    setNodes((items) =>
      items.map((item) => (item.id === id ? { ...item, data: { ...item.data, label } } : item))
    );
  }, []);
  const displayNodes = nodes.map((node) => ({
    ...node,
    data: { ...node.data, onLabel: setLabel },
  }));
  const addShape = (shape: FlowchartShape['shape']) => {
    const count = nodes.length;
    const label =
      shape === 'diamond' ? '判断条件' : shape === 'ellipse' ? '开始 / 结束' : '流程步骤';
    setNodes((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        type: 'shape',
        position: { x: 70 + (count % 3) * 230, y: 80 + Math.floor(count / 3) * 145 },
        data: { label, shape, onLabel: setLabel },
      },
    ]);
  };
  const onNodesChange = useCallback(
    (changes: NodeChange<ShapeNode>[]) => setNodes((items) => applyNodeChanges(changes, items)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => setEdges((items) => applyEdgeChanges(changes, items)),
    []
  );
  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((items) =>
        addEdge(
          {
            ...connection,
            id: crypto.randomUUID(),
            type: 'smoothstep',
            ...edgeStyle(connectorKind),
          },
          items
        )
      ),
    [connectorKind]
  );
  const changeConnectorKind = (kind: ConnectorKind) => {
    setConnectorKind(kind);
    setEdges((items) =>
      items.map((edge) => (edge.selected ? { ...edge, ...edgeStyle(kind) } : edge))
    );
  };
  const save = () => {
    onSave({
      nodes: nodes.map((node) => ({
        id: node.id,
        label: node.data.label,
        shape: node.data.shape,
        x: node.position.x,
        y: node.position.y,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: typeof edge.label === 'string' ? edge.label : undefined,
        kind: edge.data?.kind === 'line' ? 'line' : 'arrow',
      })),
    });
  };
  return (
    <Modal
      title="绘制流程图"
      open={open}
      width="min(1100px, 96vw)"
      onCancel={onClose}
      onOk={save}
      okText="保存到画布"
      destroyOnHidden
    >
      <div className={styles.editor}>
        <div className={styles.toolbar}>
          <Space wrap size={6}>
            <Button icon={<PlusOutlined />} onClick={() => addShape('rounded')}>
              起点 / 终点
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => addShape('rectangle')}>
              步骤
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => addShape('diamond')}>
              判断
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => addShape('ellipse')}>
              事件
            </Button>
            <Button
              onClick={() =>
                setNodes((items) =>
                  items.map((item, index) => ({
                    ...item,
                    position: { x: 70 + (index % 3) * 230, y: 80 + Math.floor(index / 3) * 145 },
                  }))
                )
              }
            >
              自动排版
            </Button>
            <Segmented
              aria-label="连接线样式"
              value={connectorKind}
              options={[
                { label: '➜ 箭头', value: 'arrow' },
                { label: '─ 直线', value: 'line' },
              ]}
              onChange={(value) => changeConnectorKind(value as ConnectorKind)}
            />
          </Space>
          <span>
            从右侧圆点连至目标左侧圆点；选中连线可切换箭头或直线；双击节点改文字，Delete
            删除选中项。
          </span>
        </div>
        <div className={styles.stage}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={displayNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgeDoubleClick={(_event, edge) => {
                let label = typeof edge.label === 'string' ? edge.label : '';
                Modal.confirm({
                  title: '连线标签',
                  content: (
                    <Input
                      defaultValue={label}
                      maxLength={120}
                      onChange={(event) => {
                        label = event.target.value;
                      }}
                    />
                  ),
                  onOk: () =>
                    setEdges((items) =>
                      items.map((item) => (item.id === edge.id ? { ...item, label } : item))
                    ),
                });
              }}
              fitView
              snapToGrid
              snapGrid={[16, 16]}
              deleteKeyCode={['Backspace', 'Delete']}
            >
              <Background gap={20} size={1} />
              <MiniMap
                pannable
                zoomable
                bgColor="var(--panel)"
                nodeColor="var(--accent)"
                maskColor="rgba(0, 0, 0, 0.16)"
              />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
          {!nodes.length && (
            <div className={styles.empty}>从上方添加第一个图形，双击图形输入文字</div>
          )}
        </div>
        <Button
          icon={<DeleteOutlined />}
          disabled={!nodes.some((node) => node.selected) && !edges.some((edge) => edge.selected)}
          onClick={() => {
            const removed = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
            setNodes((items) => items.filter((item) => !removed.has(item.id)));
            setEdges((items) =>
              items.filter(
                (item) => !item.selected && !removed.has(item.source) && !removed.has(item.target)
              )
            );
          }}
        >
          删除选中
        </Button>
      </div>
    </Modal>
  );
}
