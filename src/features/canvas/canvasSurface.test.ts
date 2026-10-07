import { describe, expect, it } from 'vitest';
import { isCanvasSurface, surfaceFromLegacyMessage } from './canvasSurface';

describe('legacy A2UI canvas messages', () => {
  it('converts the saved data-message structure into a visible surface', () => {
    const raw = JSON.stringify({ kind: 'data', data: [
      { version: 'v0.9.1', createSurface: { surfaceId: 'research-card', catalogId: 'catalog' } },
      { updateComponents: { components: [
        { id: 'root', component: 'Column', props: {}, children: ['title'] },
        { id: 'title', component: 'Text', props: { text: '论文结构图' } },
      ] } },
      { updateDataModel: { path: '/', value: {} } },
    ] });
    const surface = surfaceFromLegacyMessage(raw, 'workspace');
    expect(surface?.root.children[0].props.text).toBe('论文结构图');
    expect(isCanvasSurface(surface)).toBe(true);
  });

  it('rejects incomplete component trees', () => {
    const raw = JSON.stringify({ data: [
      { createSurface: { surfaceId: 'broken' } },
      { updateComponents: { components: [{ id: 'root', component: 'Column', children: ['missing'] }] } },
    ] });
    expect(surfaceFromLegacyMessage(raw, 'workspace')).toBeUndefined();
  });
});
