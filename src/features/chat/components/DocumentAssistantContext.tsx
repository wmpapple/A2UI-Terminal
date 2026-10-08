import { FileTextOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Checkbox } from 'antd';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ContextSelection } from '../../../shared/types/domain';
import { displayWorkspacePath } from '../../../shared/workspacePath';
import styles from './ChatPanel.module.css';

export function DocumentAssistantContext({
  activePath,
  selectedText,
  selection,
  onOpenContext,
  onTask,
}: {
  activePath: string;
  selectedText: string;
  selection: ContextSelection;
  onOpenContext: () => void;
  onTask: (prompt: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className={styles.documentContext} aria-label={t('currentDocument')}>
      <h2>{t('currentDocument')}</h2>
      <div className={styles.contextDocument} title={displayWorkspacePath(activePath)}>
        <FileTextOutlined />
        <strong>{activePath.split('/').at(-1) || t('noContextSelected')}</strong>
      </div>
      <h2>{t('context')}</h2>
      <div className={styles.contextSources}>
        <Checkbox
          checked={selection.currentFile && Boolean(activePath)}
          disabled={!activePath}
          onChange={onOpenContext}
        >
          {t('currentDocument')}
        </Checkbox>
        <Checkbox
          checked={selection.selection && Boolean(selectedText.trim())}
          disabled={!selectedText.trim()}
          onChange={onOpenContext}
        >
          {t('currentSelection')}
        </Checkbox>
        <Button size="small" type="text" icon={<PlusOutlined />} onClick={onOpenContext}>
          {t('addContextMaterial')}
        </Button>
      </div>
      <h2>{t('quickTasks')}</h2>
      <div className={styles.contextTasks}>
        {(
          [
            ['taskSummary', 'suggestSummary'],
            ['taskExplain', 'suggestExplain'],
            ['taskIssues', 'promptIssues'],
            ['taskOutline', 'promptOutline'],
          ] as const
        ).map(([label, prompt]) => (
          <Button key={label} size="small" onClick={() => onTask(t(prompt))}>
            {t(label)}
          </Button>
        ))}
      </div>
    </section>
  );
}
