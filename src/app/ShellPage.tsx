import { AppstoreOutlined, FileDoneOutlined, HomeOutlined } from '@ant-design/icons';
import { Button, Empty } from 'antd';
import type { ReactNode } from 'react';
import type { AppRoute } from './shellPreferences';
import { useI18n } from './i18n/useI18n';
import styles from './ShellPage.module.css';

interface Props {
  route: Exclude<AppRoute, 'workbench' | 'settings'>;
  onOpenWorkbench: () => void;
}

const icons: Record<Props['route'], ReactNode> = {
  home: <HomeOutlined />,
  results: <FileDoneOutlined />,
  templates: <AppstoreOutlined />,
};

const contentKeys = {
  home: {
    title: 'homePageTitle',
    description: 'homePageDescription',
    empty: 'homePageEmpty',
  },
  results: {
    title: 'resultsPageTitle',
    description: 'resultsPageDescription',
    empty: 'resultsPageEmpty',
  },
  templates: {
    title: 'templatesPageTitle',
    description: 'templatesPageDescription',
    empty: 'templatesPageEmpty',
  },
} as const;

export function ShellPage({ route, onOpenWorkbench }: Props) {
  const { t } = useI18n();
  const content = contentKeys[route];

  return (
    <main className={styles.page} aria-labelledby={`${route}-page-title`}>
      <div className={styles.content}>
        <div className={styles.icon}>{icons[route]}</div>
        <h1 id={`${route}-page-title`}>{t(content.title)}</h1>
        <p>{t(content.description)}</p>
        <Button type="primary" onClick={onOpenWorkbench}>
          {t('openWorkbench')}
        </Button>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(content.empty)} />
      </div>
    </main>
  );
}
