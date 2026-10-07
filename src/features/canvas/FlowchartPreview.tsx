import type { CanvasFlowchart } from '../../shared/types/canvas';
import { useId } from 'react';
import styles from './FlowchartPreview.module.css';

export function FlowchartPreview({ chart }: { chart: CanvasFlowchart }) {
  const arrowId = useId().replaceAll(':', '');
  if (!chart.nodes.length) return <div className={styles.empty}>双击以绘制流程图</div>;
  const left = Math.min(...chart.nodes.map((node) => node.x)) - 35;
  const top = Math.min(...chart.nodes.map((node) => node.y)) - 35;
  const right = Math.max(...chart.nodes.map((node) => node.x + 170)) + 35;
  const bottom = Math.max(...chart.nodes.map((node) => node.y + 72)) + 35;
  const byId = new Map(chart.nodes.map((node) => [node.id, node]));
  return (
    <svg
      className={styles.preview}
      viewBox={`${left} ${top} ${right - left} ${bottom - top}`}
      role="img"
      aria-label="流程图预览"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className={styles.arrowHead} />
        </marker>
      </defs>
      {chart.edges.map((edge) => {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target) return null;
        const x1 = source.x + 170;
        const y1 = source.y + 36;
        const x2 = target.x;
        const y2 = target.y + 36;
        return (
          <g key={edge.id} className={styles.link}>
            <path
              d={`M ${x1} ${y1} C ${x1 + 45} ${y1}, ${x2 - 45} ${y2}, ${x2} ${y2}`}
              markerEnd={edge.kind === 'line' ? undefined : `url(#${arrowId})`}
            />
            {edge.label && (
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle">
                {edge.label.slice(0, 20)}
              </text>
            )}
          </g>
        );
      })}
      {chart.nodes.map((node) => (
        <g key={node.id} className={styles.shape} data-shape={node.shape}>
          {node.shape === 'ellipse' ? (
            <ellipse cx={node.x + 85} cy={node.y + 36} rx="84" ry="35" />
          ) : node.shape === 'diamond' ? (
            <path
              d={`M ${node.x + 85} ${node.y} L ${node.x + 170} ${node.y + 36} L ${node.x + 85} ${node.y + 72} L ${node.x} ${node.y + 36} Z`}
            />
          ) : (
            <rect
              x={node.x}
              y={node.y}
              width="170"
              height="72"
              rx={node.shape === 'rounded' ? 35 : 8}
            />
          )}
          <text x={node.x + 85} y={node.y + 40} textAnchor="middle">
            {node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label}
          </text>
          <title>{node.label}</title>
        </g>
      ))}
    </svg>
  );
}
