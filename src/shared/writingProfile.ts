import type { Locale, WritingProfileSnapshot } from './types/domain';

export const formatWritingProfileForDisplay = (
  snapshot: WritingProfileSnapshot,
  locale: Locale
): string => {
  const zh = locale === 'zh-CN';
  const lines: string[] = [];

  snapshot.layers.forEach((layer) => {
    const label =
      layer.scope === 'global'
        ? zh
          ? '全局偏好'
          : 'Global Profile'
        : zh
          ? '工作区偏好'
          : 'Workspace Profile';
    lines.push(`${label}${zh ? '：' : ':'}`);
    if (layer.rules.trim()) {
      lines.push(`${zh ? '- 写作规则：' : '- Rules: '}${layer.rules.trim()}`);
    }
  });

  if (snapshot.terminology.length > 0) {
    lines.push(zh ? '- 推荐术语：' : '- Preferred terminology:');
    snapshot.terminology.forEach((rule) => {
      lines.push(`  - ${rule.term} ${zh ? '→' : '=>'} ${rule.preferred}`);
    });
  }

  if (snapshot.forbiddenWords.length > 0) {
    lines.push(
      zh
        ? `- 避免使用：${snapshot.forbiddenWords.join('、')}`
        : `- Avoid these words unless the current instruction explicitly requires them: ${snapshot.forbiddenWords.join(', ')}`
    );
  }

  return lines.join('\n');
};
