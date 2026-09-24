import { InfoNotice } from '../../shared/components/InfoNotice';
import { Alert, Button, Checkbox, Empty, Input, Modal, Select, Space, Spin, Tabs, Tag } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { isWebMock } from '../../shared/platform/runtime';
import type { ImportBatch, ImportDropOutcome } from '../../shared/types/domain';
import type { KnowledgeDocument, KnowledgeSource } from '../../shared/types/knowledge';
import { errorDetails } from '../../stores/support';
import { importController } from '../imports/importController';
import { useImportDropTarget } from '../imports/useImportDropTarget';
import { knowledgeController as api } from './knowledgeController';
import styles from './KnowledgePage.module.css';
import { ContextPackSettings } from '../contextPacks/components/ContextPackSettings';

export function KnowledgePage() {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [tab, setTab] = useState(() =>
    window.location.hash.includes('tab=packs') ? 'packs' : 'sources'
  );
  useEffect(() => {
    const sync = () => setTab(window.location.hash.includes('tab=packs') ? 'packs' : 'sources');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return (
    <section className={styles.page} aria-label={zh ? '资料库' : 'Library'}>
      <h1>{zh ? '资料库' : 'Library'}</h1>
      <p>
        {zh
          ? '保存资料，再按用途组成资料包。资料包只引用已有资料，不重复保存正文。'
          : 'Save sources and group them by purpose. Packs reference sources without duplicating content.'}
      </p>
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key);
          window.location.hash = key === 'packs' ? '/knowledge?tab=packs' : '/knowledge';
        }}
        destroyOnHidden
        items={[
          {
            key: 'sources',
            label: zh ? '全部资料' : 'All sources',
            children: <KnowledgeSources />,
          },
          { key: 'packs', label: zh ? '资料包' : 'Packs', children: <ContextPackSettings /> },
        ]}
      />
    </section>
  );
}

function KnowledgeSources() {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [items, setItems] = useState<KnowledgeSource[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [preview, setPreview] = useState<KnowledgeDocument | null>(null);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<KnowledgeSource | null>(null);
  const [mockFiles, setMockFiles] = useState<File[]>([]);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef({ value: 0 });
  const previewRequest = useRef({ value: 0 });
  const report = useCallback((e: unknown) => setError(errorDetails(e).message), []);
  const receive = useCallback((outcome: ImportDropOutcome) => {
    if (outcome.batch) {
      setBatch(outcome.batch);
      setAccepted([]);
    } else setError(outcome.errorMessage ?? 'Import failed');
  }, []);
  const dropRef = useImportDropTarget(undefined, undefined, receive);

  useEffect(() => {
    const requests = generation.current;
    const previews = previewRequest.current;
    const current = ++requests.value;
    void api
      .list({ query })
      .then((page) => {
        if (current !== generation.current.value) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((e) => {
        if (current === generation.current.value) report(e);
      })
      .finally(() => {
        if (current === generation.current.value) setBusy(false);
      });
    return () => {
      requests.value++;
      previews.value++;
    };
  }, [query, refresh, report]);

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setRefresh((n) => n + 1);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const open = async (id: string) => {
    const ticket = ++previewRequest.current.value;
    try {
      const d = await api.get(id);
      if (ticket !== previewRequest.current.value) return;
      setPreview(d);
      setTitle(d.source.title);
      setTags(d.source.tags);
    } catch (e) {
      if (ticket === previewRequest.current.value) report(e);
    }
  };
  useEffect(() => {
    const id = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id');
    let disposed = false;
    if (id)
      void api
        .get(id)
        .then((d) => {
          if (!disposed) {
            setPreview(d);
            setTitle(d.source.title);
            setTags(d.source.tags);
          }
        })
        .catch((e) => {
          if (!disposed) report(e);
        });
    return () => {
      disposed = true;
    };
  }, [report]);

  return (
    <section
      className={styles.page}
      ref={dropRef}
      aria-label={zh ? '个人资料库' : 'Personal library'}
    >
      <InfoNotice
        type="info"
        showIcon
        title={zh ? '本地保存，可跨工作区复用' : 'Saved locally, available across workspaces'}
        description={
          zh
            ? '导入不会发送给 AI。使用资料时仍需选择并确认发送范围。支持 TXT、MD、DOCX、PDF、CSV、XLSX；扫描 PDF 暂不支持 OCR。'
            : 'Import does not send data to AI. Select and confirm sources before each send. TXT, MD, DOCX, PDF, CSV and XLSX; scanned PDFs require OCR, which is not supported.'
        }
      />
      <Space wrap>
        <Input.Search
          aria-label={zh ? '搜索资料库' : 'Search library'}
          placeholder={zh ? '标题、标签或正文' : 'Title, tags or content'}
          maxLength={200}
          onSearch={(value) => {
            generation.current.value++;
            setBusy(true);
            setError(null);
            setQuery(value);
            setRefresh((n) => n + 1);
          }}
          allowClear
        />
        {isWebMock() ? (
          <label>
            {zh ? '选择文本（Web Mock）' : 'Select text (Web Mock)'}
            <input
              type="file"
              accept=".txt,.md"
              multiple
              disabled={busy}
              onChange={(e) => {
                setMockFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
        ) : (
          <Button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const b = await importController.select();
                if (b) {
                  setBatch(b);
                  setAccepted([]);
                }
              })
            }
          >
            {zh ? '导入资料 / 拖入文件' : 'Import / drop files'}
          </Button>
        )}
        <Button disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
          {zh ? '刷新' : 'Refresh'}
        </Button>
      </Space>
      {error && <Alert type="error" showIcon title={error} />}
      {busy && <Spin />}
      {!busy && items.length === 0 && (
        <Empty
          description={
            zh
              ? '暂无资料，导入后即可在不同工作区使用'
              : 'Import sources to reuse them across workspaces'
          }
        />
      )}
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <Button
                type="link"
                disabled={item.status !== 'ready'}
                onClick={() => void open(item.id)}
              >
                {item.title}
              </Button>
              <Tag>{item.format.toUpperCase()}</Tag>
              {item.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
              {item.status !== 'ready' && (
                <Tag color="warning">{zh ? '不可用 / 待清理' : item.status}</Tag>
              )}
            </div>
            <Button danger disabled={busy} onClick={() => setDeleting(item)}>
              {zh ? '删除' : 'Delete'}
            </Button>
          </li>
        ))}
      </ul>
      {cursor !== null && (
        <Button
          disabled={busy}
          onClick={() => {
            const current = generation.current.value;
            setBusy(true);
            void api
              .list({ query, after: cursor })
              .then((page) => {
                if (current === generation.current.value) {
                  setItems((v) => [...v, ...page.items]);
                  setCursor(page.nextCursor);
                }
              })
              .catch(report)
              .finally(() => {
                if (current === generation.current.value) setBusy(false);
              });
          }}
        >
          {zh ? '加载更多' : 'Load more'}
        </Button>
      )}
      <Modal
        open={Boolean(batch)}
        okText={zh ? '确认导入' : 'Confirm import'}
        cancelText={zh ? '取消' : 'Cancel'}
        title={zh ? '确认存入个人资料库' : 'Confirm local import'}
        confirmLoading={busy}
        okButtonProps={{ disabled: !batch?.canConfirm || accepted.length === 0 }}
        onOk={() =>
          void perform(async () => {
            if (!batch) return;
            const b = batch;
            setBatch(null);
            await api.confirm(b.id, accepted, true);
          })
        }
        onCancel={() => {
          if (busy) return;
          const b = batch;
          setBatch(null);
          if (b) void perform(() => api.confirm(b.id, [], false));
        }}
      >
        <p>
          {zh
            ? '仅复制勾选资料；相同内容自动复用已有记录。原文件不会被修改。'
            : 'Copy selected sources only. Identical content reuses an existing record. Original files remain unchanged.'}
        </p>
        {batch?.items.map((item) => (
          <div key={item.id}>
            <Checkbox
              checked={accepted.includes(item.id)}
              disabled={
                item.status !== 'ready' ||
                !['txt', 'md', 'pdf', 'docx', 'csv', 'xlsx'].includes(item.extension)
              }
              onChange={(e) =>
                setAccepted((v) =>
                  e.target.checked ? [...v, item.id] : v.filter((id) => id !== item.id)
                )
              }
            >
              {item.name}
            </Checkbox>
            <p>{item.reason ?? item.warnings.join(' · ')}</p>
          </div>
        ))}
        {batch?.failureReason && <Alert type="error" title={batch.failureReason} />}
      </Modal>
      <Modal
        open={mockFiles.length > 0}
        okText={zh ? '确认导入' : 'Confirm import'}
        cancelText={zh ? '取消' : 'Cancel'}
        title={zh ? '确认本地导入（Web Mock）' : 'Confirm local import (Web Mock)'}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) setMockFiles([]);
        }}
        onOk={() =>
          void perform(async () => {
            await api.importMock(mockFiles);
            setMockFiles([]);
          })
        }
      >
        {mockFiles.map((f, i) => (
          <p key={i}>{f.name}</p>
        ))}
      </Modal>
      <Modal
        open={Boolean(preview)}
        cancelText={zh ? '取消' : 'Cancel'}
        width={800}
        title={zh ? '资料预览与管理' : 'Preview and manage'}
        confirmLoading={busy}
        okText={zh ? '保存名称和标签' : 'Save title and tags'}
        onCancel={() => {
          previewRequest.current.value++;
          setPreview(null);
        }}
        onOk={() =>
          void perform(async () => {
            if (preview) await api.edit({ id: preview.source.id, title, tags });
            setPreview(null);
          })
        }
      >
        <Input
          aria-label={zh ? '资料名称' : 'Source title'}
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Select
          mode="tags"
          aria-label={zh ? '标签' : 'Tags'}
          value={tags}
          onChange={setTags}
          className={styles.tags}
          maxCount={20}
        />
        <p>
          {zh
            ? '只读提取正文；复杂版式和精确页段定位暂不提供。更新内容请删除旧副本后重新导入，已有发送清单将失效。'
            : 'Read-only extracted text; advanced layout and page/paragraph navigation are unavailable. To update content, delete and reimport; previous send manifests become invalid.'}
        </p>
        <pre className={styles.preview}>{preview?.parsed.blocks.map((b) => b.text).join('\n')}</pre>
      </Modal>
      <Modal
        open={Boolean(deleting)}
        okText={zh ? '确认删除' : 'Confirm delete'}
        cancelText={zh ? '取消' : 'Cancel'}
        title={zh ? '删除资料副本？' : 'Delete managed source?'}
        confirmLoading={busy}
        okButtonProps={{ danger: true }}
        onCancel={() => {
          if (!busy) setDeleting(null);
        }}
        onOk={() =>
          void perform(async () => {
            if (deleting) await api.delete(deleting.id);
            setDeleting(null);
            setPreview(null);
          })
        }
      >
        {zh
          ? '原文件和成果不会删除。正在进行的 AI 请求将停止。已发送给模型的内容无法撤回，已有成果和聊天中的摘录不会被自动改写。'
          : 'Original files and results are preserved. Active AI requests will stop. Previously sent data cannot be recalled; excerpts already in results or chats remain.'}
      </Modal>
    </section>
  );
}
