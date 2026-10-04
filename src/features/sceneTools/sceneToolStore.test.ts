import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopGateway } from '../../shared/platform/gateway';
import { createMockA2ui } from '../../shared/mock/workspace';
import type { SceneToolView } from '../../shared/types/sceneTool';
import { sceneTools, useSceneToolStore } from './sceneToolStore';

const view = (hash = 'base'): SceneToolView => ({
  result: { id: 'scene' } as SceneToolView['result'],
  templateId: 'collect',
  surface: { ...createMockA2ui().surface, data: { name: '初始' } },
  stateHash: hash,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  useSceneToolStore.setState({ entries: {} });
  vi.spyOn(desktopGateway, 'readSceneTool').mockResolvedValue(view());
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('scene persistence', () => {
  it('autosaves without publication and publishes only after an explicit request', async () => {
    await sceneTools.load('scene');
    vi.spyOn(desktopGateway, 'saveSceneTool').mockResolvedValue(view('saved'));
    const publish = vi.spyOn(desktopGateway, 'publishSceneTool').mockResolvedValue({
      ...view('saved'),
      publication: {
        resultId: 'snapshot',
        revisionId: 'revision',
        title: 'Snapshot',
        revisionNumber: 1,
        synced: true,
      },
    });
    sceneTools.change('scene', 'name', 'new');
    await vi.advanceTimersByTimeAsync(700);
    expect(publish).not.toHaveBeenCalled();
    expect(await sceneTools.publish('scene')).toBe(true);
    expect(publish).toHaveBeenCalledWith({
      resultId: 'scene',
      baseHash: 'saved',
      expectedRevision: null,
    });
    expect(useSceneToolStore.getState().entries.scene.view?.publication?.resultId).toBe('snapshot');
  });
  it('does not publish if saving the current input fails', async () => {
    await sceneTools.load('scene');
    vi.spyOn(desktopGateway, 'saveSceneTool').mockRejectedValue({ message: 'disk failure' });
    const publish = vi.spyOn(desktopGateway, 'publishSceneTool');
    sceneTools.change('scene', 'name', 'retained');
    expect(await sceneTools.publish('scene')).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(useSceneToolStore.getState().entries.scene.data.name).toBe('retained');
  });
  it('passes a distinct title only on explicit publication', async () => {
    await sceneTools.load('scene');
    const publish = vi.spyOn(desktopGateway, 'publishSceneTool').mockResolvedValue(view('base'));
    expect(await sceneTools.publish('scene', '信息收集结果')).toBe(true);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ title: '信息收集结果' }));
  });
  it('coalesces loads and retains unsaved input when navigating back', async () => {
    await Promise.all([sceneTools.load('scene'), sceneTools.load('scene')]);
    sceneTools.change('scene', 'name', '离开页面前输入');
    await sceneTools.load('scene');
    expect(desktopGateway.readSceneTool).toHaveBeenCalledTimes(1);
    expect(useSceneToolStore.getState().entries.scene.data.name).toBe('离开页面前输入');
  });
  it('serializes rapid edits and saves latest data against the returned hash', async () => {
    await sceneTools.load('scene');
    let resolve!: (view: SceneToolView) => void;
    const save = vi
      .spyOn(desktopGateway, 'saveSceneTool')
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      )
      .mockResolvedValueOnce(view('final'));
    sceneTools.change('scene', 'name', '第一次');
    const running = sceneTools.save('scene');
    sceneTools.change('scene', 'name', '最终中文值');
    sceneTools.change('scene', 'checked', true);
    const duplicate = sceneTools.save('scene');
    expect(save).toHaveBeenCalledTimes(1);
    resolve(view('next'));
    await Promise.all([running, duplicate]);
    expect(save).toHaveBeenLastCalledWith({
      resultId: 'scene',
      baseHash: 'next',
      data: { name: '最终中文值', checked: true },
    });
    expect(useSceneToolStore.getState().entries.scene.dirty).toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('retains entries on failure and retries without dropping fields', async () => {
    await sceneTools.load('scene');
    const save = vi
      .spyOn(desktopGateway, 'saveSceneTool')
      .mockRejectedValueOnce({ message: '磁盘故障' })
      .mockResolvedValueOnce(view('saved'));
    sceneTools.change('scene', 'name', '保留');
    expect(await sceneTools.save('scene')).toBe(false);
    expect(useSceneToolStore.getState().entries.scene).toMatchObject({
      dirty: true,
      saving: false,
      data: { name: '保留' },
      error: '磁盘故障',
    });
    expect(await sceneTools.save('scene')).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('stops auto writes after conflict until explicit reload', async () => {
    await sceneTools.load('scene');
    const save = vi
      .spyOn(desktopGateway, 'saveSceneTool')
      .mockRejectedValue({ code: 'FILE_CONFLICT', message: 'conflict' });
    sceneTools.change('scene', 'name', '旧页面输入');
    await sceneTools.save('scene');
    sceneTools.change('scene', 'name', '保留供复制');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await sceneTools.save('scene')).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(useSceneToolStore.getState().entries.scene.data.name).toBe('保留供复制');
    await sceneTools.load('scene', true);
    expect(useSceneToolStore.getState().entries.scene).toMatchObject({
      conflict: false,
      dirty: false,
    });
  });
  it('auto saves even when no component subscribes anymore', async () => {
    await sceneTools.load('scene');
    vi.spyOn(desktopGateway, 'saveSceneTool').mockResolvedValue(view('saved'));
    sceneTools.change('scene', 'name', '跨路由保存');
    await vi.advanceTimersByTimeAsync(700);
    expect(useSceneToolStore.getState().entries.scene.dirty).toBe(false);
  });
});
