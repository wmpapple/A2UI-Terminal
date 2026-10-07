import { describe, expect, it } from 'vitest';
import type { CanvasBlock } from '../../shared/types/canvas';
import { noteHtml, sanitizeNoteHtml } from './richNoteHtml';

const block: CanvasBlock = {
  id: 'note',
  type: 'note',
  title: '笔记',
  body: '原文==重点==',
  x: 0,
  y: 0,
  width: 280,
  height: 190,
  zIndex: 1,
  createdAt: '',
  updatedAt: '',
};

describe('rich canvas notes', () => {
  it('preserves bold, italic, highlight and text color while removing executable markup', () => {
    const html = sanitizeNoteHtml(
      '<strong>重点</strong><em>方法</em><span style="color:#b93843;background-color:rgb(255, 227, 139)" onclick="alert(1)">结论</span><img src=x onerror=alert(1)><script>alert(2)</script>'
    );
    expect(html).toContain('<strong>重点</strong>');
    expect(html).toContain('<em>方法</em>');
    expect(html).toContain('color: rgb(185, 56, 67)');
    expect(html).toContain('background-color: rgb(255, 227, 139)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
  });

  it('keeps old highlighted plain notes readable', () => {
    expect(noteHtml(block)).toContain('<mark');
    expect(noteHtml(block)).toContain('重点');
  });
});
