import { describe, expect, it } from 'vitest';
import type { A2uiNode, A2uiSurface } from '../../shared/types/domain';
import { groupSceneToolSurface } from './groupSceneToolSurface';

const input = (id: string, label: string): A2uiNode => ({
  id,
  component: 'TextField',
  props: { name: id, label },
  children: [],
  actions: { change: { type: 'set_state', target: id } },
});

const surface = {
  root: {
    id: 'root',
    component: 'Column',
    props: {},
    actions: {},
    children: [
      {
        id: 'title',
        component: 'Text',
        props: { text: '采访提纲' },
        children: [],
        actions: {},
      },
      input('subject', '主题 / 对象'),
      input('guest', '受访人'),
      input('item0_answer', '背景与经历 · 记录'),
      input('item0_followup', '背景与经历 · 追问'),
    ],
  },
  data: {},
} as A2uiSurface;

describe('groupSceneToolSurface', () => {
  it('groups existing interview fields without changing their ids or actions', () => {
    const grouped = groupSceneToolSurface(surface, 'interview', true);
    const groups = grouped.root.children.filter((node) => node.id.startsWith('scene-group-'));
    expect(groups.map((node) => node.children[0].props.text)).toEqual(['基本信息', '背景与经历']);
    expect(groups[1].children[1]).toMatchObject({
      id: 'item0_answer',
      props: { name: 'item0_answer', label: '背景与经历 · 记录' },
      actions: { change: { type: 'set_state', target: 'item0_answer' } },
    });
    expect(surface.root.children[3].props.label).toBe('背景与经历 · 记录');
  });
});
