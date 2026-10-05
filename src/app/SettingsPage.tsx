import {
  CloudOutlined,
  DesktopOutlined,
  ExperimentOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Button, Tag, message } from 'antd';
import { useState } from 'react';
import { SystemSettings } from '../features/settings/components/SystemSettings';
import { WritingProfileSettings } from '../features/settings/components/WritingProfileSettings';
import { useAppStore } from '../stores/useAppStore';
import type { ExperienceMode } from './shellPreferences';
import { useI18n } from './i18n/useI18n';
import styles from './SettingsPage.module.css';

interface Props {
  experienceMode: ExperienceMode;
  onExperienceModeChange: (mode: ExperienceMode) => void;
  onOpenProviderSettings: () => void;
}

type Category = 'general' | 'ai' | 'writing' | 'updates' | 'privacy';

const providerNames: Record<string, string> = {
  siliconflow: 'SiliconFlow',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  custom: 'OpenAI-Compatible',
};

export function SettingsPage({
  experienceMode,
  onExperienceModeChange,
  onOpenProviderSettings,
}: Props) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [category, setCategory] = useState<Category>('general');
  const [writingVisited, setWritingVisited] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const workspace = useAppStore((state) => state.workspace);
  const configs = useAppStore((state) => state.providerConfigs);
  const activeProviderId = useAppStore((state) => state.activeProviderId);
  const processing = useAppStore((state) => state.processingOptions);
  const testProvider = useAppStore((state) => state.testProvider);
  const activeProvider = configs.find((item) => item.id === activeProviderId);
  const local = processing?.processingLocation === 'local';
  const ready = processing?.availability === 'ready';
  const categories: { id: Category; label: string }[] = [
    { id: 'general', label: zh ? '常规' : 'General' },
    { id: 'ai', label: zh ? 'AI 与模型' : 'AI & models' },
    { id: 'writing', label: zh ? '写作偏好' : 'Writing profile' },
    { id: 'updates', label: zh ? '更新与诊断' : 'Updates & diagnostics' },
    { id: 'privacy', label: zh ? '隐私与数据' : 'Privacy & data' },
  ];
  const selected = categories.find((item) => item.id === category)!;

  return (
    <main className={styles.page} aria-labelledby="settings-page-title">
      <div className={styles.content}>
        <header className={styles.pageHeader}>
          <SettingOutlined aria-hidden="true" />
          <div>
            <h1 id="settings-page-title">{zh ? '设置' : 'Settings'}</h1>
            <p>{zh ? '配置工作台的使用方式' : 'Configure how your workspace works'}</p>
          </div>
        </header>
        <div className={styles.layout}>
          <nav className={styles.navigation} aria-label={zh ? '设置分类' : 'Settings categories'}>
            {categories.map((item) => (
              <button
                key={item.id}
                type="button"
                className={category === item.id ? styles.activeCategory : styles.category}
                aria-current={category === item.id ? 'page' : undefined}
                onClick={() => {
                  setCategory(item.id);
                  if (item.id === 'writing') setWritingVisited(true);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <section className={styles.panel} aria-labelledby="settings-category-title">
            <h2 id="settings-category-title">{selected.label}</h2>
            {category === 'general' && (
              <div className={styles.section}>
                <div className={styles.row}>
                  <div>
                    <h3>{zh ? '界面模式' : 'Interface mode'}</h3>
                    <p>
                      {experienceMode === 'professional'
                        ? zh
                          ? '显示 Provider、高级参数、Inspector 和诊断功能。'
                          : 'Show providers, advanced parameters, inspector and diagnostics.'
                        : zh
                          ? '保留日常使用的核心功能，隐藏高级配置。'
                          : 'Keep everyday controls visible and advanced settings out of the way.'}
                    </p>
                  </div>
                  <select
                    className={styles.modeSelect}
                    aria-label={zh ? '界面模式' : 'Interface mode'}
                    value={experienceMode}
                    onChange={(event) =>
                      onExperienceModeChange(event.target.value as ExperienceMode)
                    }
                  >
                    <option value="simple">{zh ? '简单模式' : 'Simple mode'}</option>
                    <option value="professional">{zh ? '专业模式' : 'Professional mode'}</option>
                  </select>
                </div>
                <div className={styles.row}>
                  <div>
                    <h3>{zh ? '语言' : 'Language'}</h3>
                    <p>{zh ? '可从顶部导航快速切换。' : 'Switch from the top navigation.'}</p>
                  </div>
                  <span className={styles.value}>{zh ? '中文' : 'English'}</span>
                </div>
              </div>
            )}
            {category === 'ai' && (
              <div className={styles.section}>
                <div className={styles.modelHeader}>
                  <div className={styles.modelIcon} aria-hidden="true">
                    {local ? <DesktopOutlined /> : <CloudOutlined />}
                  </div>
                  <div className={styles.modelIdentity}>
                    <h3>
                      {ready
                        ? zh
                          ? '当前模型'
                          : 'Current model'
                        : zh
                          ? 'AI 尚未配置'
                          : 'AI is not ready'}
                    </h3>
                    {ready ? (
                      <p>
                        {activeProviderId
                          ? (providerNames[activeProviderId] ?? activeProviderId)
                          : local
                            ? 'Local'
                            : 'Cloud'}
                        {activeProvider?.model ? ` · ${activeProvider.model}` : ''}
                      </p>
                    ) : (
                      <p>
                        {zh
                          ? '配置云端 Provider，或选择本地模型后即可使用 AI 功能。'
                          : 'Configure a cloud provider or select a local model to use AI.'}
                      </p>
                    )}
                  </div>
                  <Tag color={ready ? 'success' : 'warning'}>
                    {ready ? (zh ? '可用' : 'Ready') : zh ? '需配置' : 'Setup required'}
                  </Tag>
                </div>
                <div className={styles.actions}>
                  <Button
                    type="primary"
                    icon={<SettingOutlined />}
                    aria-label={
                      ready ? (zh ? '配置模型' : 'Configure model') : zh ? '配置 AI' : 'Set up AI'
                    }
                    onClick={onOpenProviderSettings}
                  >
                    {ready ? (zh ? '配置模型' : 'Configure model') : zh ? '配置 AI' : 'Set up AI'}
                  </Button>
                  {ready && activeProviderId && (
                    <Button
                      icon={<ExperimentOutlined />}
                      aria-label={zh ? '测试连接' : 'Test connection'}
                      loading={testingConnection}
                      onClick={async () => {
                        setTestingConnection(true);
                        try {
                          await testProvider(activeProviderId);
                          message.success(zh ? '模型连接正常' : 'Model connection successful');
                        } catch {
                          message.error(
                            zh
                              ? '连接测试失败，请检查模型配置。'
                              : 'Connection failed. Check model settings.'
                          );
                        } finally {
                          setTestingConnection(false);
                        }
                      }}
                    >
                      {zh ? '测试连接' : 'Test connection'}
                    </Button>
                  )}
                </div>
                <div className={styles.row}>
                  <div>
                    <h3>{zh ? '处理方式' : 'Processing location'}</h3>
                    <p>
                      {zh
                        ? '本地模型在本机处理；云端模型发送前会确认上下文范围。'
                        : 'Local models run on this device; cloud requests confirm their context first.'}
                    </p>
                  </div>
                  <span className={styles.value}>
                    {local ? (zh ? '本地' : 'Local') : zh ? '云端' : 'Cloud'}
                  </span>
                </div>
              </div>
            )}
            {writingVisited && (
              <div hidden={category !== 'writing'}>
                <WritingProfileSettings
                  key={workspace?.id ?? 'global'}
                  workspaceId={workspace?.id}
                  workspaceName={workspace?.name}
                />
              </div>
            )}
            {category === 'updates' && (
              <SystemSettings view="updates" professional={experienceMode === 'professional'} />
            )}
            {category === 'privacy' && <SystemSettings view="privacy" />}
          </section>
        </div>
      </div>
    </main>
  );
}
