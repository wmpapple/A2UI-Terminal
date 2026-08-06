import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '../../shared/types/domain';
import { I18nContext } from './context';
import { messages, type MessageKey } from './messages';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('zh-CN');
  const t = useCallback((key: MessageKey) => messages[locale][key], [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
