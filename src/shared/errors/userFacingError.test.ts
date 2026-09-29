import { expect, it } from 'vitest';
import { userFacingError } from './userFacingError';

it('localizes both coded conflicts and legacy public messages', () => {
  for (const error of [
    { code: 'FILE_CONFLICT', message: 'backend detail' },
    'file changed outside A2UI Workbench',
    new Error('file changed outside A2UI Workbench'),
  ]) {
    expect(userFacingError(error, 'zh-CN')).toContain('文档版本或编辑状态已变化');
    expect(userFacingError(error, 'en-US')).toContain(
      'The document version or editing state has changed'
    );
  }
});

it('preserves other errors instead of reporting a false version conflict', () => {
  expect(userFacingError(new Error('请求超时'), 'zh-CN')).toBe('请求超时');
});
