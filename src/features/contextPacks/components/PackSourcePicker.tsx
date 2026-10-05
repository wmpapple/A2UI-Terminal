import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Input, Popover, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { DocumentSource } from '../../../shared/types/domain';
import type { KnowledgeSource } from '../../../shared/types/knowledge';
import { errorDetails } from '../../../stores/support';
import { knowledgeController } from '../../knowledge/knowledgeController';
import styles from './ContextPackSettings.module.css';

interface Props {
  kind: 'workspace' | 'personal';
  workspaceSources: DocumentSource[];
  value: string[];
  totalSelected: number;
  onChange: (ids: string[]) => void;
  onPersonalSourceChosen?: (source: KnowledgeSource) => void;
}

export function PackSourcePicker({
  kind,
  workspaceSources,
  value,
  totalSelected,
  onChange,
  onPersonalSourceChosen,
}: Props) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [personalSources, setPersonalSources] = useState<KnowledgeSource[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);

  useEffect(() => {
    if (!open || kind !== 'personal') return;
    const ticket = ++request.current;
    const timer = setTimeout(() => {
      setBusy(true);
      setPersonalSources([]);
      setError('');
      void knowledgeController
        .list({ query })
        .then((page) => {
          if (ticket !== request.current) return;
          setPersonalSources(page.items);
          setCursor(page.nextCursor);
        })
        .catch((cause) => {
          if (ticket === request.current) setError(errorDetails(cause).message);
        })
        .finally(() => {
          if (ticket === request.current) setBusy(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      request.current = ticket + 1;
    };
  }, [kind, open, query]);

  const personal = kind === 'personal';
  const label = personal
    ? zh ? '添加个人资料' : 'Add library sources'
    : zh ? '添加工作区资料' : 'Add workspace sources';
  const choices = personal
    ? personalSources.filter((source) => source.status === 'ready').map((source) => ({
        id: source.id,
        name: source.title,
        source,
      }))
    : workspaceSources
        .filter((source) => source.name.toLowerCase().includes(query.toLowerCase()))
        .map((source) => ({ id: source.id, name: source.name, source: null }));

  const loadMore = () => {
    if (cursor === null || busy) return;
    const ticket = request.current;
    setBusy(true);
    void knowledgeController
      .list({ query, after: cursor })
      .then((page) => {
        if (ticket !== request.current) return;
        setPersonalSources((current) => [...current, ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch((cause) => {
        if (ticket === request.current) setError(errorDetails(cause).message);
      })
      .finally(() => {
        if (ticket === request.current) setBusy(false);
      });
  };

  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      open={open}
      onOpenChange={setOpen}
      content={
        <div className={styles.pickerPanel} role="group" aria-label={label}>
          <div className={styles.pickerHeading}>
            <strong>{personal ? (zh ? '我的资料' : 'My sources') : (zh ? '工作区资料' : 'Workspace sources')}</strong>
            <span>{totalSelected}/20</span>
          </div>
          <Input
            allowClear
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={`${zh ? '搜索' : 'Search'}${personal ? (zh ? '个人资料' : ' library sources') : (zh ? '工作区资料' : ' workspace sources')}`}
            placeholder={zh ? '搜索资料' : 'Search sources'}
          />
          {error && <Alert type="error" title={error} />}
          <div className={styles.pickerChoices}>
            {choices.map((choice) => {
              const selected = value.includes(choice.id);
              return (
                <Checkbox
                  key={choice.id}
                  checked={selected}
                  disabled={!selected && totalSelected >= 20}
                  onChange={(event) => {
                    onChange(event.target.checked
                      ? [...value, choice.id]
                      : value.filter((id) => id !== choice.id));
                    if (event.target.checked && choice.source) onPersonalSourceChosen?.(choice.source);
                  }}
                >
                  {choice.name}
                </Checkbox>
              );
            })}
            {busy && <Spin size="small" />}
            {!busy && choices.length === 0 && (
              <span className={styles.pickerEmpty}>
                {personal
                  ? zh ? '没有匹配的个人资料' : 'No matching library sources'
                  : zh ? '没有匹配的工作区资料' : 'No matching workspace sources'}
              </span>
            )}
          </div>
          {personal && cursor !== null && (
            <Button size="small" type="link" disabled={busy} onClick={loadMore}>
              {zh ? '加载更多' : 'Load more'}
            </Button>
          )}
          <div className={styles.pickerFooter}>
            <Button size="small" aria-label={zh ? '完成' : 'Done'} onClick={() => setOpen(false)}>
              {zh ? '完成' : 'Done'}
            </Button>
          </div>
        </div>
      }
    >
      <Button className={styles.pickerTrigger} icon={<PlusOutlined />} aria-label={label}>
        {label}
      </Button>
    </Popover>
  );
}
