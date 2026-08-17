import { describe, expect, it, vi } from 'vitest';
import { readOnboardingComplete, writeOnboardingComplete } from './onboardingPreferences';

describe('onboarding preferences', () => {
  it('defaults to showing onboarding and stores only the completion flag', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readOnboardingComplete(storage)).toBe(false);
    writeOnboardingComplete(storage);
    expect(readOnboardingComplete(storage)).toBe(true);
    expect([...values.values()]).toEqual(['true']);
  });

  it('remains usable when preference storage is unavailable', () => {
    expect(
      readOnboardingComplete({
        getItem: vi.fn(() => {
          throw new Error('blocked');
        }),
      })
    ).toBe(false);
    expect(() =>
      writeOnboardingComplete({
        setItem: vi.fn(() => {
          throw new Error('blocked');
        }),
      })
    ).not.toThrow();
  });
});
