import { Alert, Button, Select } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import type { KnowledgeSource } from '../../shared/types/knowledge';
import { errorDetails } from '../../stores/support';
import { knowledgeController } from './knowledgeController';

export function KnowledgePicker({
  value,
  onChange,
  purpose = 'send',
  maxCount = 20,
  disabled = false,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  purpose?: 'send' | 'pack';
  maxCount?: number;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [items, setItems] = useState<KnowledgeSource[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const version = useRef({ value: 0 });
  useEffect(() => {
    const requests = version.current;
    const ticket = ++requests.value;
    const timer = setTimeout(() => {
      setBusy(true);
      setError('');
      void knowledgeController
        .list({ query })
        .then((page) => {
          if (ticket === version.current.value) {
            setItems(page.items);
            setCursor(page.nextCursor);
          }
        })
        .catch((e) => {
          if (ticket === version.current.value) setError(errorDetails(e).message);
        })
        .finally(() => {
          if (ticket === version.current.value) setBusy(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      requests.value++;
    };
  }, [query]);
  return (
    <div>
      <p>
        {purpose === 'pack'
          ? zh
            ? '从个人资料中选择（可搜索）'
            : 'Choose library sources (search available)'
          : zh
            ? '个人资料（仅本次选择，发送前确认）'
            : 'Personal library (select for this request, confirm before sending)'}
      </p>
      <Select
        disabled={disabled}
        mode="multiple"
        maxCount={maxCount}
        style={{ width: '100%' }}
        aria-label={zh ? '选择个人资料' : 'Select personal sources'}
        value={value}
        onChange={onChange}
        showSearch={{ filterOption: false, onSearch: setQuery }}
        loading={busy}
        options={items
          .filter((s) => s.status === 'ready')
          .map((s) => ({ value: s.id, label: s.title }))}
      />
      {cursor !== null && (
        <Button
          disabled={busy || disabled}
          onClick={() => {
            const ticket = version.current.value;
            setBusy(true);
            void knowledgeController
              .list({ query, after: cursor })
              .then((page) => {
                if (ticket === version.current.value) {
                  setItems((v) => [...v, ...page.items]);
                  setCursor(page.nextCursor);
                }
              })
              .catch((e) => {
                if (ticket === version.current.value) setError(errorDetails(e).message);
              })
              .finally(() => {
                if (ticket === version.current.value) setBusy(false);
              });
          }}
        >
          {zh ? '加载更多' : 'Load more'}
        </Button>
      )}
      {error && <Alert type="error" title={error} />}
    </div>
  );
}
