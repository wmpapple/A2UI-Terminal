import { useI18n } from '../../app/i18n/useI18n';
import type { SceneLinkView } from '../../shared/types/sceneTool';

export function BindingVersions({ view }: { view: SceneLinkView }) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const link = view.link;
  if (!link) return null;
  const describe = (revision: SceneLinkView['boundRevision']) => {
    if (!revision) return zh ? '保存时间不可用' : 'Save time unavailable';
    // SQLite CURRENT_TIMESTAMP is UTC but has no zone suffix.
    const iso = revision.savedAt.replace(' ', 'T');
    const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`);
    if (Number.isNaN(date.getTime())) return zh ? '保存时间不可用' : 'Save time unavailable';
    const source =
      {
        initial: zh ? '初始保存' : 'Initial save',
        autosave: zh ? '自动保存' : 'Autosave',
        restore: zh ? '恢复保存' : 'Restored save',
        manual: zh ? '手动保存' : 'Manual save',
        legacy: zh ? '历史保存' : 'Historical save',
      }[revision.source] ?? (zh ? '已保存' : 'Saved');
    return `${date.toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} · ${source}`;
  };
  return (
    <>
      <p>
        {zh ? '关联时版本：' : 'Version at binding: '}
        {describe(view.boundRevision)}
      </p>
      <p>
        {zh ? '核对版本：' : 'Reviewed version: '}
        {link.reviewedHash ? describe(view.reviewedRevision) : zh ? '尚未核对' : 'Not reviewed'}
      </p>
      <details>
        <summary>{zh ? '版本标识详情' : 'Version identifiers'}</summary>
        <div style={{ overflowWrap: 'anywhere' }}>
          <p>
            {zh ? '关联时修订标识：' : 'Bound revision ID: '}
            {link.boundRevisionId ?? (zh ? '无，以内容指纹为准' : 'None; content fingerprint used')}
          </p>
          <p>
            {zh ? '关联时内容指纹：' : 'Bound content fingerprint: '}
            {link.boundHash}
          </p>
          {link.reviewedHash ? (
            <>
              <p>
                {zh ? '核对时修订标识：' : 'Reviewed revision ID: '}
                {link.reviewedRevisionId ??
                  (zh ? '无，以内容指纹为准' : 'None; content fingerprint used')}
              </p>
              <p>
                {zh ? '核对时内容指纹：' : 'Reviewed content fingerprint: '}
                {link.reviewedHash}
              </p>
            </>
          ) : null}
        </div>
      </details>
    </>
  );
}
