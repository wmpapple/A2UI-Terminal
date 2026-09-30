import {
  AudioOutlined,
  CheckSquareOutlined,
  FileSearchOutlined,
  InboxOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Input, Modal, Spin, Tag } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { sceneToolController } from './sceneToolController';
import { CreationBindingPicker } from './CreationBindingPicker';
import type { SceneTemplate, ToolBinding } from '../../shared/types/sceneTool';
import { useAppStore } from '../../stores/useAppStore';
import styles from './SceneTools.module.css';

const templateLooks: Record<string, { icon: ReactNode; zhTags: string[]; enTags: string[] }> = {
  publish: {
    icon: <SafetyCertificateOutlined />,
    zhTags: ['文档', '可独立'],
    enTags: ['Document', 'Standalone'],
  },
  interview: {
    icon: <AudioOutlined />,
    zhTags: ['访谈', '可独立'],
    enTags: ['Interview', 'Standalone'],
  },
  review: {
    icon: <FileSearchOutlined />,
    zhTags: ['文档', '可独立'],
    enTags: ['Document', 'Standalone'],
  },
  tasks: {
    icon: <CheckSquareOutlined />,
    zhTags: ['任务', '可独立'],
    enTags: ['Tasks', 'Standalone'],
  },
  collect: {
    icon: <InboxOutlined />,
    zhTags: ['收集', '可独立'],
    enTags: ['Collection', 'Standalone'],
  },
};

export function SceneTemplateCards({
  onOpenResult,
  initialBinding,
  currentBinding,
  recommendedTemplateId,
}: {
  onOpenResult: (id: string) => void;
  initialBinding?: ToolBinding;
  currentBinding?: ToolBinding;
  /** Allows a later recommendation policy to choose the single featured template. */
  recommendedTemplateId?: string;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const desktop = useAppStore((s) => s.runtimeMode === 'desktop');
  const [templates, setTemplates] = useState<SceneTemplate[]>([]);
  const [selected, setSelected] = useState<SceneTemplate | null>(null);
  const [binding, setBinding] = useState<ToolBinding>({ type: 'none' });
  const [title, setTitle] = useState('');
  const [items, setItems] = useState('');
  const [busy, setBusy] = useState(false);
  const [bindingReady, setBindingReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void sceneToolController
      .listTemplates(locale)
      .then((value) => {
        if (active) setTemplates(value);
      })
      .catch((e: { message?: string }) => {
        if (active) setError(e.message ?? String(e));
      });
    return () => {
      active = false;
    };
  }, [desktop, locale]);
  const entries = items
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = Boolean(
    selected &&
    bindingReady &&
    title.trim() &&
    entries.length &&
    entries.length <= selected.maxItems &&
    entries.every((s) => Array.from(s).length <= 24)
  );
  const create = async (template: SceneTemplate, custom = false) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await sceneToolController.create(
        {
          templateId: template.id,
          title: custom ? title : template.name,
          items: custom ? entries : template.defaultItems,
          locale,
        },
        custom ? binding : (initialBinding ?? { type: 'none' })
      );
      setSelected(null);
      onOpenResult(created.result.id);
    } catch (e) {
      setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  };
  const configure = (template: SceneTemplate) => {
    setSelected(template);
    setBinding(initialBinding ?? { type: 'none' });
    setBindingReady(true);
    setTitle(template.name);
    setItems(template.defaultItems.join('\n'));
    setError(null);
  };
  const card = (template: SceneTemplate) => {
    const look = templateLooks[template.id] ?? templateLooks.collect;
    return (
      <Card
        key={template.id}
        className={styles.templateCard}
        title={
          <span className={styles.templateCardTitle}>
            <span className={styles.templateIcon}>{look.icon}</span>
            {template.name}
          </span>
        }
      >
        <div className={styles.templateCardBody}>
          <p>{template.description}</p>
          <div className={styles.templateTags} aria-label={zh ? '适用范围' : 'Template scope'}>
            {(zh ? look.zhTags : look.enTags).map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
          <div className={styles.templateActions}>
            <Button type="primary" disabled={busy} onClick={() => void create(template)}>
              {zh ? '使用模板' : 'Use template'}
            </Button>
            <Button type="link" disabled={busy} onClick={() => configure(template)}>
              {zh ? '自定义 →' : 'Customize →'}
            </Button>
          </div>
        </div>
      </Card>
    );
  };
  const recommended =
    templates.find((template) => template.id === recommendedTemplateId) ?? templates[0];
  return (
    <>
      {error ? (
        <Alert type="error" showIcon title={error} closable onClose={() => setError(null)} />
      ) : null}
      {!desktop ? (
        <p>
          {zh
            ? '请在桌面程序中创建和保存场景工具。'
            : 'Create and save scene tools in the desktop app.'}
        </p>
      ) : !templates.length && !error ? (
        <Spin />
      ) : null}

      {recommended ? (
        <section
          className={styles.recommendedTemplate}
          aria-label={zh ? '推荐模板' : 'Recommended template'}
          data-template-id={recommended.id}
        >
          <div className={styles.recommendedIcon}>
            {(templateLooks[recommended.id] ?? templateLooks.collect).icon}
          </div>
          <div className={styles.recommendedCopy}>
            <span className={styles.recommendedLabel}>{zh ? '推荐' : 'Recommended'}</span>
            <h2>{recommended.name}</h2>
            <p>{recommended.description}</p>
            <div className={styles.templateTags}>
              {(zh
                ? (templateLooks[recommended.id] ?? templateLooks.collect).zhTags
                : (templateLooks[recommended.id] ?? templateLooks.collect).enTags
              ).map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          </div>
          <Button type="primary" disabled={busy} onClick={() => void create(recommended)}>
            {zh ? '立即使用' : 'Use now'}
          </Button>
        </section>
      ) : null}

      <section aria-label={zh ? '内置场景工具模板' : 'Built-in tool templates'}>
        <h2>{zh ? '内置场景工具模板' : 'Built-in tool templates'}</h2>
        <div className={styles.templateGrid}>{templates.map(card)}</div>
      </section>

      <Modal
        title={
          selected ? (zh ? `自定义${selected.name}` : `Customize ${selected.name}`) : undefined
        }
        open={Boolean(selected)}
        confirmLoading={busy}
        okText={zh ? '创建工具' : 'Create tool'}
        cancelText={zh ? '取消' : 'Cancel'}
        okButtonProps={{ disabled: !valid }}
        onCancel={() => {
          if (!busy) setSelected(null);
        }}
        onOk={async () => {
          if (!selected || !valid || busy) return;
          await create(selected, true);
        }}
      >
        <CreationBindingPicker
          key={selected?.id ?? 'closed'}
          value={binding}
          onChange={setBinding}
          currentBinding={currentBinding}
          onReady={setBindingReady}
          disabled={busy}
        />
        <label className={styles.field}>
          {zh ? '工具名称' : 'Tool title'}
          <Input
            value={title}
            maxLength={160}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          {selected?.itemLabel}
          <Input.TextArea
            value={items}
            disabled={busy}
            autoSize={{ minRows: 5, maxRows: 12 }}
            onChange={(e) => setItems(e.target.value)}
          />
        </label>
        <p>
          {zh
            ? `每行一项，最多 ${selected?.maxItems ?? 5} 项，每项最多 24 字。自定义只影响本次创建；需要长期复用时，可在“我的工具”中保存为个人模板。`
            : `One item per line, up to ${selected?.maxItems ?? 5} items and 24 characters each. Customization applies to this tool only; save it as a personal template later if needed.`}
        </p>
        {error ? <Alert type="error" showIcon title={error} /> : null}
      </Modal>
    </>
  );
}
