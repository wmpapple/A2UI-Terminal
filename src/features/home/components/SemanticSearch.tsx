import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Tag,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { semanticSearchController as api } from '../semanticSearchController';
import { isWebMock } from '../../../shared/platform/runtime';
import type { ProviderConfig, SearchAuthorizedContentOutput } from '../../../shared/types/domain';
import type { EmbeddingConfig, SemanticPlan } from '../../../shared/types/semanticSearch';
import { errorDetails } from '../../../stores/support';

export function SemanticSearch({
  query,
  workspaceId,
  onResult,
}: {
  query: string;
  workspaceId: string | null;
  onResult: (value: SearchAuthorizedContentOutput) => void;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const say = (cn: string, en: string) => (zh ? cn : en);
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [config, setConfig] = useState<EmbeddingConfig>({
    providerId: '',
    model: '',
    revision: 'v1',
    dimensions: 384,
    location: 'local',
  });
  const [plan, setPlan] = useState<SemanticPlan | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef<string | null>(null);
  const epoch = useRef(0);
  const cancel = () => {
    epoch.current++;
    if (active.current) void api.cancelSemanticSearch(active.current).catch(() => {});
    active.current = null;
  };
  useEffect(
    () => () => {
      epoch.current++;
      if (active.current) void api.cancelSemanticSearch(active.current).catch(() => {});
    },
    []
  );

  const begin = async () => {
    cancel();
    setOpen(true);
    setBusy(true);
    setError(null);
    setPlan(null);
    setNotice(null);
    const version = epoch.current;
    try {
      const [items, saved] = await Promise.all([
        api.listProviderConfigs(),
        api.getSemanticConfig(),
      ]);
      if (version !== epoch.current) return;
      const local = (p: ProviderConfig) =>
        ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(p.endpoint).hostname);
      setProviders([...items].sort((a, b) => Number(local(b)) - Number(local(a))));
      if (saved) {
        setConfig(saved);
        const next = await api.planSemanticSearch({
          search: { workspaceId, query: query.trim(), limit: 20 },
          config: saved,
          sourceKeys: null,
        });
        if (version !== epoch.current) {
          void api.cancelSemanticSearch(next.id).catch(() => {});
          return;
        }
        active.current = next.id;
        setPlan(next);
        setSelected(next.sources.map((s) => s.key));
      }
    } catch (e) {
      if (version === epoch.current) setError(errorDetails(e).message);
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  };
  const prepare = async (keys: string[] | null = null) => {
    cancel();
    const version = epoch.current;
    setBusy(true);
    setError(null);
    try {
      const next = await api.planSemanticSearch({
        search: { workspaceId, query: query.trim(), limit: 20 },
        config,
        sourceKeys: keys,
      });
      if (version !== epoch.current) {
        void api.cancelSemanticSearch(next.id).catch(() => {});
        return;
      }
      active.current = next.id;
      setPlan(next);
      setSelected(next.sources.map((s) => s.key));
    } catch (e) {
      if (version === epoch.current) {
        setError(errorDetails(e).message);
        setPlan(null);
      }
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  };
  const run = async () => {
    if (!plan) return;
    const version = epoch.current;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      for (;;) {
        const step = await api.stepSemanticSearch(plan.id, true);
        if (version !== epoch.current) return;
        setProgress(Math.round((step.completed / Math.max(1, step.total)) * 100));
        if (step.done) {
          if (step.result) onResult(step.result);
          setNotice(
            step.fallbackReason
              ? say(
                  step.fallbackReason,
                  'Semantic search was unavailable. Keyword results are shown.'
                )
              : say('已结合关键词与语义匹配排序。', 'Results combine keyword and semantic matches.')
          );
          setOpen(false);
          setBusy(false);
          cancel();
          break;
        }
      }
    } catch (e) {
      if (version === epoch.current) {
        setError(errorDetails(e).message);
        setBusy(false);
        cancel();
        const fallbackVersion = epoch.current;
        setPlan(null);
        // Permission/content changes must be re-read; never return the old plan's hits.
        try {
          const result = await api.searchAuthorizedContent({ workspaceId, query, limit: 20 });
          if (fallbackVersion === epoch.current) onResult(result);
        } catch {
          /* visible planning error */
        }
      }
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  };
  const changed =
    plan &&
    (selected.length !== plan.sources.length ||
      selected.some((k) => !plan.sources.some((s) => s.key === k)));
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}
    >
      <Button size="small" disabled={!query.trim() || isWebMock()} onClick={() => void begin()}>
        {say('语义搜索', 'Semantic search')}
      </Button>
      {notice && (
        <Alert
          style={{ flex: 1, minWidth: 220 }}
          showIcon
          type="info"
          title={notice}
          closable
          onClose={() => setNotice(null)}
        />
      )}
      <Modal
        title={say('语义搜索与发送范围', 'Semantic search and data scope')}
        open={open}
        footer={null}
        onCancel={() => {
          cancel();
          setOpen(false);
          setBusy(false);
        }}
        width={660}
      >
        {error && (
          <Alert showIcon type="error" title={error} closable onClose={() => setError(null)} />
        )}
        {!plan ? (
          <Form layout="vertical">
            <Alert
              showIcon
              type="info"
              closable
              title={say(
                '请使用专用向量模型。服务和 API Key 在设置中配置；这里只选择模型，不会自动发送资料。',
                'Use an embedding model. Configure the service and API key in Settings. Selecting a model does not send your data.'
              )}
            />
            <Form.Item label={say('处理服务', 'Service')}>
              <Select
                aria-label={say('处理服务', 'Service')}
                value={config.providerId || undefined}
                disabled={busy}
                options={providers.map((p) => ({ value: p.id, label: `${p.id} · ${p.endpoint}` }))}
                onChange={(id) => {
                  const provider = providers.find((p) => p.id === id)!;
                  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
                    new URL(provider.endpoint).hostname
                  );
                  setConfig({ ...config, providerId: id, location: local ? 'local' : 'cloud' });
                }}
              />
            </Form.Item>
            <Form.Item label={say('向量模型名称', 'Embedding model')}>
              <Input
                aria-label={say('向量模型名称', 'Embedding model')}
                value={config.model}
                disabled={busy}
                maxLength={256}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
              />
            </Form.Item>
            <Form.Item
              label={say(
                '模型版本标记（更换权重后更新）',
                'Model revision (update after changing weights)'
              )}
            >
              <Input
                aria-label={say('模型版本标记', 'Model revision')}
                value={config.revision}
                disabled={busy}
                maxLength={128}
                onChange={(e) => setConfig({ ...config, revision: e.target.value })}
              />
            </Form.Item>
            <Form.Item label={say('向量维度', 'Dimensions')}>
              <InputNumber
                aria-label={say('向量维度', 'Dimensions')}
                min={1}
                max={4096}
                value={config.dimensions}
                disabled={busy}
                onChange={(v) => setConfig({ ...config, dimensions: v ?? 384 })}
              />
            </Form.Item>
            <Button
              type="primary"
              loading={busy}
              disabled={!config.providerId || !config.model.trim()}
              onClick={() => void prepare()}
            >
              {say('规划发送范围', 'Review data scope')}
            </Button>
          </Form>
        ) : (
          <>
            <p>
              <Tag>
                {plan.config.location === 'local'
                  ? say('本机服务', 'Local endpoint')
                  : say('云端服务', 'Cloud service')}
              </Tag>
              {plan.endpoint}
            </p>
            <p>
              {plan.config.model} · {plan.config.revision} · {plan.config.dimensions}
            </p>
            <p>
              {say('本次搜索词也会发送：', 'Your search query will also be sent: ')}
              <strong>{plan.query}</strong>
            </p>
            <p>
              {say(
                `共 ${plan.totalChunks} 个片段；需发送 ${plan.missingChunks} 个新片段，共 ${plan.characters} 字符（含搜索词）。`,
                `${plan.totalChunks} chunks; ${plan.missingChunks} new chunks, ${plan.characters} characters including your query.`
              )}
            </p>
            <p>
              {say(
                '缓存片段不会重复发送。新片段包含资料正文、标题和标签；云端可能按服务商规则计费。',
                'Cached chunks are not sent again. New chunks include content, titles and tags. Cloud services may charge for processing.'
              )}
            </p>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              <Checkbox.Group
                value={selected}
                disabled={busy}
                onChange={(v) => setSelected(v as string[])}
              >
                <Space orientation="vertical">
                  {plan.sources.map((s) => (
                    <Checkbox key={s.key} value={s.key}>
                      {s.title} · {s.characters} {say('字符', 'characters')}
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>
            </div>
            {busy && (
              <>
                <Progress percent={progress} status="active" />
                <p>
                  {progress === 100
                    ? say('正在匹配搜索词…', 'Matching your query…')
                    : say('正在处理资料…', 'Processing sources…')}
                </p>
              </>
            )}
            <Space style={{ marginTop: 16 }}>
              <Button
                type="primary"
                loading={busy}
                disabled={!selected.length}
                onClick={() => void (changed ? prepare(selected) : run())}
              >
                {changed
                  ? say('更新发送清单', 'Update scope')
                  : say('确认并搜索', 'Confirm and search')}
              </Button>
              <Button
                onClick={() => {
                  cancel();
                  setBusy(false);
                  setPlan(null);
                }}
              >
                {say(busy ? '停止' : '重新配置', busy ? 'Stop' : 'Configure again')}
              </Button>
            </Space>
          </>
        )}
      </Modal>
    </div>
  );
}
