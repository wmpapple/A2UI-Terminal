import {
  CloseOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  ToolOutlined,
  FileDoneOutlined,
  LayoutOutlined,
  BookOutlined,
} from '@ant-design/icons';
import { Button } from 'antd';
import type { WorkItem, WorkItemType } from '../shared/types/workItem';
import styles from './WorkItemTabs.module.css';

const icons: Record<WorkItemType, React.ReactNode> = {
  document: <FileTextOutlined />,
  tool: <ToolOutlined />,
  project: <BookOutlined />,
  'project-section': <FileTextOutlined />,
  result: <FileDoneOutlined />,
  canvas: <LayoutOutlined />,
};

export function WorkItemTabs({
  items,
  activeId,
  onSelect,
  onClose,
}: {
  items: WorkItem[];
  activeId: string | null;
  onSelect: (item: WorkItem) => void;
  onClose?: (item: WorkItem) => void;
}) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Open work items">
      {items.map((item) => (
        <div
          className={styles.tab}
          data-active={item.id === activeId}
          key={`${item.type}:${item.id}`}
        >
          <button
            type="button"
            role="tab"
            aria-label={item.title}
            aria-selected={item.id === activeId}
            className={styles.select}
            onClick={() => onSelect(item)}
            title={item.title}
          >
            {icons[item.type]}
            <span>{item.title}</span>
            {item.status === 'dirty' && <i className={styles.dirty} aria-label="Unsaved" />}
            {item.status === 'conflict' && (
              <ExclamationCircleOutlined className={styles.conflict} aria-label="Conflict" />
            )}
          </button>
          {onClose && (
            <Button
              type="text"
              size="small"
              aria-label={`Close ${item.title}`}
              icon={<CloseOutlined />}
              onClick={() => onClose(item)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
