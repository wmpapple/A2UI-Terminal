import { ConfigProvider } from 'antd';
import { WorkbenchAppearanceContext } from './workbenchAppearanceContext';
import { useState, type ReactNode } from 'react';
import { useI18n } from './i18n/useI18n';
import { useSystemTheme } from './useSystemTheme';
import styles from './WorkbenchAppearance.module.css';

const STORAGE_KEY = 'a2ui.workbench.eye-care.v1';

export function WorkbenchAppearance({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const dark = useSystemTheme();
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const changeMode = (next: boolean) => {
    setEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Keep the switch usable when browser storage is unavailable.
    }
  };

  return (
    <ConfigProvider
      theme={
        enabled
          ? {
              token: {
                colorPrimary: dark ? '#bdc99c' : '#52663c',
                colorBgContainer: dark ? '#292c24' : '#f5f1e3',
                colorBgElevated: dark ? '#30342a' : '#faf6e9',
                colorBgLayout: dark ? '#20231d' : '#eee9d8',
                colorText: dark ? '#e3e3d3' : '#363e2f',
                colorTextSecondary: dark ? '#b9bca8' : '#62694f',
                colorBorder: dark ? '#4a503f' : '#d4d3bc',
              },
            }
          : {}
      }
    >
      <section
        className={`${styles.frame} ${enabled ? styles.eyeCare : ''}`}
        aria-label={t('workbenchNavigation')}
        data-eye-care={enabled}
      >
        <WorkbenchAppearanceContext.Provider value={{ enabled, changeMode }}>
          {children}
        </WorkbenchAppearanceContext.Provider>
      </section>
    </ConfigProvider>
  );
}
