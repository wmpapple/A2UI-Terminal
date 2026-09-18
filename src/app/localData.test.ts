import { describe, expect, it, vi } from 'vitest';
import { clearWebviewLocalData, scheduleApplicationReload } from './localData';

describe('clearWebviewLocalData', () => {
  it('clears persistent and session-only application preferences', () => {
    const persistent = { clear: vi.fn() };
    const sessionOnly = { clear: vi.fn() };

    clearWebviewLocalData(persistent, sessionOnly);

    expect(persistent.clear).toHaveBeenCalledOnce();
    expect(sessionOnly.clear).toHaveBeenCalledOnce();
  });

  it('still clears the session store when persistent storage is unavailable', () => {
    const sessionOnly = { clear: vi.fn() };

    expect(() =>
      clearWebviewLocalData(
        {
          clear: () => {
            throw new Error('blocked');
          },
        },
        sessionOnly
      )
    ).not.toThrow();
    expect(sessionOnly.clear).toHaveBeenCalledOnce();
  });

  it('schedules a reload after the clear completion message can render', () => {
    const timeout = vi.spyOn(window, 'setTimeout').mockImplementation(() => 1);

    scheduleApplicationReload(250);

    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 250);
    timeout.mockRestore();
  });
});
