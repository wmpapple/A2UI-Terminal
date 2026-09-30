import type { A2uiNode, A2uiSurface } from '../../shared/types/domain';

const nodeName = (node: A2uiNode) => (typeof node.props.name === 'string' ? node.props.name : '');

const fieldLabel = (node: A2uiNode) =>
  typeof node.props.label === 'string' ? node.props.label : '';

const heading = (key: string, label: string): A2uiNode => ({
  id: `scene-heading-${key}`,
  component: 'Text',
  props: { text: label, weight: 'semibold' },
  children: [],
  actions: {},
});

const section = (key: string, label: string, children: A2uiNode[]): A2uiNode | null =>
  children.length
    ? {
        id: `scene-group-${key}`,
        component: 'Column',
        props: { gap: 'md' },
        children: [heading(key, label), ...children],
        actions: {},
      }
    : null;

/**
 * Adds visual sections without changing the stored A2UI surface. This also improves tools that
 * were created before sections existed, while preserving field ids and actions for autosave.
 */
export const groupSceneToolSurface = (
  surface: A2uiSurface,
  templateId: string,
  zh: boolean
): A2uiSurface => {
  if (surface.root.children.some((node) => node.id.startsWith('scene-group-'))) return surface;

  const title = surface.root.children.find(
    (node) => node.id === 'title' && node.component === 'Text'
  );
  const summary = surface.root.children.find((node) => node.component === 'ResultSummary');
  const fields = surface.root.children.filter(
    (node) => node !== title && node !== summary && Boolean(nodeName(node))
  );
  if (!fields.length) return surface;

  const used = new Set<string>();
  const take = (names: string[]) =>
    fields.filter((node) => {
      if (!names.includes(nodeName(node))) return false;
      used.add(node.id);
      return true;
    });
  const remaining = () => fields.filter((node) => !used.has(node.id));
  const groups: A2uiNode[] = [];
  const add = (node: A2uiNode | null) => {
    if (node) groups.push(node);
  };

  if (templateId === 'publish') {
    add(section('basic', zh ? '基本信息' : 'Basic information', take(['subject', 'owner'])));
    add(section('checks', zh ? '发布检查' : 'Publication checks', take(['checks'])));
    add(section('notes', zh ? '问题与备注' : 'Issues and notes', take(['notes'])));
  } else if (templateId === 'interview') {
    add(section('basic', zh ? '基本信息' : 'Basic information', take(['subject', 'guest'])));
    const indexes = [
      ...new Set(
        fields
          .map((node) => /^item(\d+)_/.exec(nodeName(node))?.[1])
          .filter((value): value is string => Boolean(value))
      ),
    ];
    indexes.forEach((index) => {
      const nodes = take([`item${index}_answer`, `item${index}_followup`, `item${index}_done`]);
      const label =
        fieldLabel(nodes[0]).split(' · ')[0] || `${zh ? '问题' : 'Question'} ${Number(index) + 1}`;
      add(section(`item-${index}`, label, nodes));
    });
  } else if (templateId === 'review' || templateId === 'tasks') {
    add(section('basic', zh ? '基本信息' : 'Basic information', take(['subject'])));
    const indexes = [
      ...new Set(
        fields
          .map((node) => /^item(\d+)_/.exec(nodeName(node))?.[1])
          .filter((value): value is string => Boolean(value))
      ),
    ];
    indexes.forEach((index) => {
      const nodes = fields.filter((node) => nodeName(node).startsWith(`item${index}_`));
      nodes.forEach((node) => used.add(node.id));
      const label =
        fieldLabel(nodes[0]).split(' · ')[0] || `${zh ? '项目' : 'Item'} ${Number(index) + 1}`;
      add(section(`item-${index}`, label, nodes));
    });
  } else if (templateId === 'collect') {
    add(section('basic', zh ? '基本信息' : 'Basic information', take(['subject'])));
    const content = remaining();
    content.forEach((node) => used.add(node.id));
    add(section('content', zh ? '收集内容' : 'Information to collect', content));
  } else {
    add(section('content', zh ? '填写内容' : 'Tool fields', fields));
    fields.forEach((node) => used.add(node.id));
  }

  add(section('other', zh ? '其他内容' : 'Other fields', remaining()));
  return {
    ...surface,
    root: {
      ...surface.root,
      children: [...(title ? [title] : []), ...groups, ...(summary ? [summary] : [])],
    },
  };
};
