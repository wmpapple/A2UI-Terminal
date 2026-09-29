import { Alert, Button, Modal, Space, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import type { CitationView } from '../../shared/types/citation';
import { citationController } from './citationController';
import { locatorLabel } from './locatorLabel';
import { errorDetails } from '../../stores/support';

export function CitationPanel({
  ownerKind,
  ownerId,
  content,
  dirty = false,
}: {
  ownerKind: 'result' | 'message' | 'writing_run';
  ownerId: string;
  content: string;
  dirty?: boolean;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [items, setItems] = useState<CitationView[]>([]);
  const [selected, setSelected] = useState<CitationView | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const previewRequest = useRef({ value: 0 });
  useEffect(() => {
    const requests = previewRequest.current;
    let active = true;
    if (!/\[S\d+\]/.test(content)) return;
    const load = dirty
      ? Promise.resolve(
          [...new Set(content.match(/\[S\d+\]/g) ?? [])].map((key): CitationView => ({
            key: key.slice(1, -1),
            title: '',
            locator: null,
            status: 'stale',
            excerpt: null,
          }))
        )
      : citationController.list(ownerKind, ownerId, content);
    void load
      .then((v) => {
        if (active) {
          setItems(v);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(errorDetails(e).message);
      });
    return () => {
      active = false;
      requests.value++;
    };
  }, [ownerKind, ownerId, content, dirty, refresh]);
  if (!/\[S\d+\]/.test(content)) return null;
  const status = (item: CitationView) => {
    if (dirty) return zh ? '正文未保存，待核验' : 'Unsaved changes, verification pending';
    return {
      verified: zh ? '来源已核验' : 'Source verified',
      unknown: zh ? '未知引用' : 'Unknown citation',
      stale: zh ? '引用待重新核验' : 'Reverification required',
      unauthorized: zh ? '授权已撤销' : 'Authorization revoked',
      unavailable: zh ? '来源不可用' : 'Source unavailable',
    }[item.status];
  };
  return (
    <section
      aria-label={zh ? '引用来源' : 'Cited sources'}
      style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color, #dce4ee)' }}
    >
      <Space wrap>
        <strong>{zh ? '引用来源' : 'Cited sources'}</strong>
        <Button size="small" onClick={() => setRefresh((v) => v + 1)}>
          {zh ? '重新核验' : 'Recheck'}
        </Button>
      </Space>
      {error ? <Alert type="error" title={error} closable onClose={() => setError('')} /> : null}
      <Space wrap>
        {items.map((item) => (
          <Button
            key={item.key}
            size="small"
            onClick={() => {
              const request = ++previewRequest.current.value;
              setSelected({ ...item, excerpt: null });
              if (dirty) return;
              void citationController
                .list(ownerKind, ownerId, content)
                .then((next) => {
                  if (request !== previewRequest.current.value) return;
                  setItems(next);
                  setSelected(next.find((i) => i.key === item.key) ?? null);
                })
                .catch((e) => {
                  if (request === previewRequest.current.value) setError(errorDetails(e).message);
                });
            }}
          >
            [{item.key}] {item.title} · {status(item)}
          </Button>
        ))}
      </Space>
      <Modal
        open={selected !== null}
        title={selected ? `[${selected.key}] ${selected.title}` : ''}
        footer={null}
        onCancel={() => {
          previewRequest.current.value++;
          setSelected(null);
        }}
      >
        {selected ? (
          <>
            <Tag color={!dirty && selected.status === 'verified' ? 'green' : 'orange'}>
              {status(selected)}
            </Tag>
            <p>{locatorLabel(selected.locator, zh)}</p>
            <p>
              {zh
                ? '来源核验仅表示来源身份、发送范围和版本一致，不代表事实已核实。'
                : 'Source verification confirms identity, approved scope and version; it does not verify factual claims.'}
            </p>
            {!dirty && selected.excerpt !== null ? (
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '50vh', overflow: 'auto' }}>
                {selected.excerpt}
              </pre>
            ) : (
              <p>
                {zh
                  ? '当前引用无法显示已核验原文，请重新生成或核对来源。'
                  : 'Verified source text is unavailable. Regenerate or check the source.'}
              </p>
            )}
          </>
        ) : null}
      </Modal>
    </section>
  );
}
