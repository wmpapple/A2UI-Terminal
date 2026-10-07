import {
  DeleteOutlined,
  FileOutlined,
  FolderOutlined,
  LayoutOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { Button, Empty, Input, Modal, Select, Tooltip, message } from 'antd';
import { useMemo, useState } from 'react';
import type { CanvasBinding, CanvasDocument } from '../../shared/types/canvas';
import styles from './CanvasSidebar.module.css';

interface Props {
  canvases: CanvasDocument[];
  activeId: string | null;
  filePaths: string[];
  onCreate: (title: string, binding: CanvasBinding) => Promise<void>;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}

export function CanvasSidebar({
  canvases,
  activeId,
  filePaths,
  onCreate,
  onOpen,
  onDelete,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'none' | 'file' | 'folder'>('none');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [messageApi, messageHolder] = message.useMessage();
  const folders = useMemo(
    () =>
      Array.from(
        new Set(
          filePaths.flatMap((file) => {
            const parts = file.split('/');
            return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
          })
        )
      ).sort(),
    [filePaths]
  );
  const groups = [
    {
      title: '关联文件与文件夹',
      items: canvases.filter((canvas) => canvas.binding.type !== 'none'),
    },
    { title: '独立画布', items: canvases.filter((canvas) => canvas.binding.type === 'none') },
  ];
  return (
    <aside className={styles.sidebar} aria-label="画布列表">
      <header>
        <strong>画布</strong>
        <Button icon={<PlusOutlined />} size="small" onClick={() => setCreateOpen(true)}>
          新建
        </Button>
      </header>
      <p className={styles.hint}>组织论文、流程和想法的空间</p>
      <div className={styles.list}>
        {groups.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            {group.items.map((canvas) => (
              <div
                className={`${styles.row} ${canvas.id === activeId ? styles.active : ''}`}
                key={canvas.id}
              >
                <button type="button" onClick={() => onOpen(canvas.id)}>
                  {canvas.binding.type === 'file' ? (
                    <FileOutlined />
                  ) : canvas.binding.type === 'folder' ? (
                    <FolderOutlined />
                  ) : (
                    <LayoutOutlined />
                  )}
                  <span>
                    <strong>{canvas.title}</strong>
                    <small>
                      {canvas.binding.type === 'none'
                        ? '独立'
                        : canvas.binding.type === 'result'
                          ? '关联成果'
                          : canvas.binding.path}
                    </small>
                    <small>
                      {new Date(canvas.updatedAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </span>
                </button>
                <Tooltip title="删除画布">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`删除画布 ${canvas.title}`}
                    onClick={() =>
                      Modal.confirm({
                        title: `删除画布「${canvas.title}」？`,
                        content: '画布上的组件与连线将一并删除；关联文件不会删除。',
                        okText: '删除',
                        okButtonProps: { danger: true },
                        cancelText: '取消',
                        onOk: () => onDelete(canvas.id),
                      })
                    }
                  />
                </Tooltip>
              </div>
            ))}
          </section>
        ))}
        {!canvases.length && <Empty description="还没有画布" />}
      </div>
      {messageHolder}
      <Modal
        title="新建画布"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        okText="创建并打开"
        confirmLoading={busy}
        onOk={async () => {
          if (!title.trim()) {
            void messageApi.warning('请输入画布名称');
            return;
          }
          if (kind !== 'none' && !path) {
            void messageApi.warning('请选择关联对象');
            return;
          }
          setBusy(true);
          try {
            await onCreate(title.trim(), kind === 'none' ? { type: 'none' } : { type: kind, path });
            setTitle('');
            setKind('none');
            setPath('');
            setCreateOpen(false);
          } catch (cause) {
            void messageApi.error(String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className={styles.form}>
          <label>
            名称
            <Input
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：论文方法分析"
            />
          </label>
          <label>
            关联对象
            <Select
              value={kind}
              options={[
                { value: 'none', label: '独立画布' },
                { value: 'file', label: '文件' },
                { value: 'folder', label: '文件夹' },
              ]}
              onChange={(value) => {
                setKind(value);
                setPath('');
              }}
            />
          </label>
          {kind !== 'none' && (
            <label>
              {kind === 'file' ? '文件' : '文件夹'}
              <Select
                showSearch
                value={path || undefined}
                placeholder="选择路径"
                options={(kind === 'file' ? filePaths : folders).map((value) => ({
                  label: value,
                  value,
                }))}
                onChange={setPath}
              />
            </label>
          )}
        </div>
      </Modal>
    </aside>
  );
}
