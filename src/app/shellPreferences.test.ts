import { describe, expect, it } from 'vitest';
import {
  readExperienceMode,
  routeFromHash,
  writeExperienceMode,
  type ExperienceMode,
} from './shellPreferences';

describe('application shell preferences', () => {
  it('defaults to simple mode and accepts only the explicit professional value', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readExperienceMode(storage)).toBe('simple');
    values.set('a2ui.experience-mode.v1', 'advanced');
    expect(readExperienceMode(storage)).toBe('simple');
    writeExperienceMode('professional', storage);
    expect(readExperienceMode(storage)).toBe<ExperienceMode>('professional');
  });

  it('maps only known hash routes and falls back to home', () => {
    expect(routeFromHash('#/results')).toBe('results');
    expect(routeFromHash('#/workbench?source=home')).toBe('workbench');
    expect(routeFromHash('#/unknown')).toBe('home');
    expect(routeFromHash('')).toBe('home');
  });

  it('keeps simple mode usable when browser storage is unavailable', () => {
    const unavailableStorage = {
      getItem: () => {
        throw new DOMException('Storage disabled', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      },
    };

    expect(readExperienceMode(unavailableStorage)).toBe('simple');
    expect(() => writeExperienceMode('professional', unavailableStorage)).not.toThrow();
  });
});
