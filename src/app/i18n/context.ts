import { createContext } from 'react';
import type { Locale } from '../../shared/types/domain';
import type { MessageKey } from './messages';

export interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
}

export const I18nContext = createContext<I18nValue | null>(null);
