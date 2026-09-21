import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopApi } from './desktop';

const { onDragDropEvent } = vi.hoisted(() => ({ onDragDropEvent: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent }) }));
vi.mock('./runtime', () => ({ getRuntimeMode: () => 'desktop' }));

afterEach(() => vi.restoreAllMocks());

describe('native drag visual feedback', () => {
  it('converts physical coordinates and forwards no file paths, clearing on drop and leave', async () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    const stop = vi.fn();
    onDragDropEvent.mockResolvedValue(stop);
    const handler = vi.fn();
    expect(await desktopApi.listenImportDragPosition(handler)).toBe(stop);
    const notify = onDragDropEvent.mock.calls[0][0];
    notify({
      payload: { type: 'enter', paths: ['private-file.txt'], position: { x: 200, y: 400 } },
    });
    expect(handler).toHaveBeenLastCalledWith({ x: 100, y: 200 });
    notify({ payload: { type: 'over', position: { x: 220, y: 420 } } });
    expect(handler).toHaveBeenLastCalledWith({ x: 110, y: 210 });
    notify({
      payload: { type: 'drop', paths: ['private-file.txt'], position: { x: 220, y: 420 } },
    });
    expect(handler).toHaveBeenLastCalledWith(null);
    notify({ payload: { type: 'leave' } });
    expect(handler).toHaveBeenLastCalledWith(null);
  });
});
