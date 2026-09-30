import { Alert, Button, Drawer, Empty } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { useAppStore } from '../../stores/useAppStore';
import type { ToolBinding } from '../../shared/types/sceneTool';
import type { ResultSummary } from '../../shared/types/domain';
import { sceneToolController } from './sceneToolController';
import { SceneTemplateCards } from './SceneTemplateCards';

export function BoundSceneTools({
  binding,
  dirty,
  onOpenResult,
}: {
  binding: ToolBinding;
  dirty: boolean;
  onOpenResult: (id: string) => void;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const desktop = useAppStore((s) => s.runtimeMode === 'desktop');
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<ResultSummary[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    if (!open || !desktop) return;
    let active = true;
    void sceneToolController
      .listLinked(binding)
      .then((v) => {
        if (active) {
          setItems(v);
          setError('');
        }
      })
      .catch((e: { message?: string }) => {
        if (active) setError(e.message ?? String(e));
      });
    return () => {
      active = false;
    };
  }, [binding, open, desktop]);
  if (!desktop) return null;
  return (
    <>
      <Button
        disabled={dirty}
        onClick={() => setOpen(true)}
        title={dirty ? (zh ? '请先保存文档' : 'Save the document first') : undefined}
      >
        {zh ? '关联工具' : 'Linked tools'}
      </Button>
      <Drawer
        title={zh ? '关联场景工具' : 'Document tools'}
        open={open}
        onClose={() => setOpen(false)}
        size={760}
      >
        <p>
          {zh
            ? '这里默认关联当前对象。所有工具都可以更换关联或选择独立使用，已有工具也可解除关联。'
            : 'The current target is selected by default. Every tool can change or remove its binding and work independently.'}
        </p>
        {error ? <Alert type="error" title={error} /> : null}
        <h3>{zh ? '已关联工具' : 'Linked tools'}</h3>
        {!items.length ? (
          <Empty description={zh ? '尚无关联工具' : 'No linked tools'} />
        ) : (
          items.map((item) => (
            <p key={item.id}>
              <Button onClick={() => onOpenResult(item.id)}>{item.title}</Button>
            </p>
          ))
        )}
        <SceneTemplateCards initialBinding={binding} onOpenResult={onOpenResult} />
      </Drawer>
    </>
  );
}
