import { DeleteOutlined, MoreOutlined, ToolOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Dropdown, Modal, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { sceneToolController } from './sceneToolController';
import type { A2uiTemplate } from '../../shared/types/domain';
import { useAppStore } from '../../stores/useAppStore';
import { BindingPicker } from './BindingPicker';
import type { ToolBinding } from '../../shared/types/sceneTool';
import styles from './SceneTools.module.css';

const sourceNames: Record<string, { zh: string; en: string }> = {
  publish: { zh: '发布检查表', en: 'Publication checklist' },
  interview: { zh: '采访提纲', en: 'Interview guide' },
  review: { zh: '文档审核表', en: 'Document review' },
  tasks: { zh: '任务清单', en: 'Task checklist' },
  collect: { zh: '信息收集表', en: 'Information form' },
};

export function SavedSceneTemplates({
  onOpenResult,
  onOpenMyTools,
}: {
  onOpenResult: (id: string) => void;
  onOpenMyTools: () => void;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const desktop = useAppStore((s) => s.runtimeMode === 'desktop');
  const [templates, setTemplates] = useState<A2uiTemplate[]>([]);
  const [selected, setSelected] = useState<A2uiTemplate | null>(null);
  const [deleting, setDeleting] = useState<A2uiTemplate | null>(null);
  const [binding, setBinding] = useState<ToolBinding>({ type: 'none' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderedAt] = useState(() => Date.now());
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void sceneToolController
      .listSavedTemplates()
      .then((v) => {
        if (active) setTemplates(v);
      })
      .catch((e: { message?: string }) => {
        if (active) setError(e.message ?? String(e));
      });
    return () => {
      active = false;
    };
  }, [desktop]);
  if (!desktop) return null;

  const updated = (value: string) => {
    const date = new Date(value);
    const days = Math.max(0, Math.floor((renderedAt - date.getTime()) / 86_400_000));
    if (days === 0) return zh ? '今天更新' : 'Updated today';
    if (days < 30) return zh ? `${days} 天前更新` : `Updated ${days} days ago`;
    return zh
      ? `${date.toLocaleDateString(locale)} 更新`
      : `Updated ${date.toLocaleDateString(locale)}`;
  };
  const source = (template: A2uiTemplate) => {
    const name = template.sourceTemplateId ? sourceNames[template.sourceTemplateId] : undefined;
    return name ? (zh ? name.zh : name.en) : zh ? '场景工具模板' : 'Scene tool template';
  };

  return (
    <section aria-label={zh ? '工具模板' : 'Tool Templates'}>
      <h3>{zh ? '工具模板' : 'Tool templates'}</h3>
      {error ? (
        <Alert type="error" showIcon title={error} closable onClose={() => setError(null)} />
      ) : null}
      {!templates.length ? (
        <div className={styles.personalTemplateEmpty}>
          <span className={styles.personalTemplateEmptyIcon}>
            <ToolOutlined />
          </span>
          <h3>{zh ? '还没有个人模板' : 'No personal templates yet'}</h3>
          <p>
            {zh
              ? '在“工具”中选择“保存为个人模板”后，会显示在这里。'
              : 'Choose “Save as personal template” in Tools and it will appear here.'}
          </p>
          <Button type="primary" onClick={onOpenMyTools}>
            {zh ? '前往工具' : 'Go to Tools'}
          </Button>
        </div>
      ) : (
        <div className={styles.personalTemplateGrid}>
          {templates.map((template) => (
            <Card
              key={template.id}
              className={styles.personalTemplateCard}
              title={
                <span className={styles.personalTemplateTitle}>
                  <ToolOutlined />
                  {template.name}
                </span>
              }
              extra={<Tag color="orange">{zh ? '我的模板' : 'My template'}</Tag>}
            >
              <p className={styles.personalTemplateMeta}>
                {zh ? '我的模板' : 'My template'} · {updated(template.updatedAt)}
              </p>
              <p className={styles.personalTemplateSource}>
                {zh ? '基于：' : 'Based on: '}
                <strong>{source(template)}</strong>
              </p>
              {!template.valid ? <Alert type="warning" title={template.invalidReason} /> : null}
              <div className={styles.personalTemplateActions}>
                <Button
                  type="primary"
                  disabled={busy || !template.valid}
                  onClick={() => {
                    setSelected(template);
                    setBinding({ type: 'none' });
                    setError(null);
                  }}
                >
                  {zh ? '使用模板' : 'Use template'}
                </Button>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      {
                        key: 'delete',
                        danger: true,
                        icon: <DeleteOutlined />,
                        label: zh ? '删除模板' : 'Delete template',
                        onClick: () => setDeleting(template),
                      },
                    ],
                  }}
                >
                  <Button
                    aria-label={
                      zh ? `更多模板操作：${template.name}` : `More actions: ${template.name}`
                    }
                    icon={<MoreOutlined />}
                  />
                </Dropdown>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal
        open={Boolean(selected)}
        title={zh ? '使用个人模板' : 'Use personal template'}
        okText={zh ? '创建工具' : 'Create tool'}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setSelected(null);
        }}
        onOk={async () => {
          if (!selected || busy) return;
          setBusy(true);
          setError(null);
          try {
            const view = await sceneToolController.openTemplate(selected.id, binding);
            setSelected(null);
            onOpenResult(view.result.id);
          } catch (e) {
            setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {zh
            ? '新工具不会继承旧关联和填写值。可以独立使用，也可以选择关联对象。'
            : 'The new tool starts without prior values or links. It can stay standalone or use an optional target.'}
        </p>
        <BindingPicker value={binding} onChange={setBinding} disabled={busy} />
        {error ? <Alert type="error" title={error} /> : null}
      </Modal>
      <Modal
        open={Boolean(deleting)}
        title={zh ? `删除模板“${deleting?.name ?? ''}”？` : `Delete “${deleting?.name ?? ''}”?`}
        okText={zh ? '删除' : 'Delete'}
        cancelText={zh ? '取消' : 'Cancel'}
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setDeleting(null);
        }}
        onOk={async () => {
          if (!deleting || busy) return;
          setBusy(true);
          try {
            await sceneToolController.deleteTemplate(deleting.id);
            setTemplates((items) => items.filter((item) => item.id !== deleting.id));
            setDeleting(null);
          } catch (e) {
            setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {zh
            ? '只删除模板，已经创建的工具和手动保存的成果都会保留。'
            : 'Only the template is deleted. Existing tools and saved results remain.'}
        </p>
      </Modal>
    </section>
  );
}
