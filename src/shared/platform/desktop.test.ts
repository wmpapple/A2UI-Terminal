import { describe, expect, it } from 'vitest';
import { desktopApi } from './desktop';

describe('desktop API boundary', () => {
  it('refuses privileged commands in Web Mock mode', async () => {
    await expect(desktopApi.getBootstrapStatus()).rejects.toThrow(
      'Desktop API is unavailable in Web Mock mode.'
    );
  });
});
