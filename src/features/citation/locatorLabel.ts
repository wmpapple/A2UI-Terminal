import type { CitationLocator } from '../../shared/types/citation';
export function locatorLabel(locator: CitationLocator | null, zh: boolean): string {
  if (!locator) return zh ? '位置不可用' : 'Location unavailable';
  switch (locator.kind) {
    case 'page':
      return zh ? `第 ${locator.page} 页` : `Page ${locator.page}`;
    case 'paragraph':
      return zh ? `第 ${locator.paragraph} 段` : `Paragraph ${locator.paragraph}`;
    case 'lines':
      return zh
        ? `第 ${locator.startLine}–${locator.endLine} 行`
        : `Lines ${locator.startLine}–${locator.endLine}`;
    case 'table_range':
      return zh
        ? `${locator.sheet} · 第 ${locator.startRow}–${locator.endRow} 行，第 ${locator.startColumn}–${locator.endColumn} 列`
        : `${locator.sheet} · Rows ${locator.startRow}–${locator.endRow}, columns ${locator.startColumn}–${locator.endColumn}`;
    default:
      return zh ? '来源级定位（无精确位置）' : 'Source only (precise location unavailable)';
  }
}
