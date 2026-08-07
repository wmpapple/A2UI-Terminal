import { describe, expect, it } from 'vitest';
import { TextStreamBuffer } from './textStreamBuffer';

describe('TextStreamBuffer', () => {
  it('splits a large provider delta into progressive UI updates', async () => {
    const frames: string[] = [];
    const buffer = new TextStreamBuffer((text) => frames.push(text), 0, 4);

    buffer.push('abcdefghijkl');
    await buffer.finish();

    expect(frames).toEqual(['abcd', 'efgh', 'ijkl']);
  });

  it('preserves provider text exactly while buffering', async () => {
    const frames: string[] = [];
    const buffer = new TextStreamBuffer((text) => frames.push(text), 0, 3);

    buffer.push('你好');
    buffer.push('，世界');
    await buffer.finish();

    expect(frames.join('')).toBe('你好，世界');
  });
});
