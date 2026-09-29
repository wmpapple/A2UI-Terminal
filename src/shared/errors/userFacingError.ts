import { errorDetails } from '../../stores/support';

// Older stores retain only the public message; support that form as well as error codes.
export function userFacingError(error: unknown, locale: string): string {
  const detail = errorDetails(error);
  if (detail.code === 'FILE_CONFLICT' || detail.message === 'file changed outside A2UI Workbench') {
    return locale === 'zh-CN'
      ? '文档版本或编辑状态已变化，本次操作未执行。请先保留当前未保存的内容，再重新打开文档并重试。'
      : 'The document version or editing state has changed, so this operation was not performed. Keep any unsaved content, then reopen the document and try again.';
  }
  return detail.message;
}
