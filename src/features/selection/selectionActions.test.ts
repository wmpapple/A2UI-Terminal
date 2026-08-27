import { describe, expect, it } from 'vitest';
import { isExplanationAction, selectionActionPrompt } from './selectionActions';

describe('selection actions', () => {
  it('keeps explanation read-only', () => {
    expect(isExplanationAction('explain')).toBe(true);
    expect(selectionActionPrompt('explain')).toContain('不要修改文件');
    expect(selectionActionPrompt('explain')).not.toContain('document_patch JSON');
  });

  it('routes modifying actions to an explicit review protocol', () => {
    expect(isExplanationAction('polish')).toBe(false);
    expect(selectionActionPrompt('polish')).toContain('只修改当前选区');
    expect(selectionActionPrompt('custom', '改成主动语态')).toContain('改成主动语态');
    expect(selectionActionPrompt('custom', '改成主动语态')).toContain('document_patch JSON');
  });
});
