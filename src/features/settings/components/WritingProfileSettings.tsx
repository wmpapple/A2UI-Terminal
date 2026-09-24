import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Divider,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  message,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { InfoNotice } from '../../../shared/components/InfoNotice';
import { formatWritingProfileForDisplay } from '../../../shared/writingProfile';
import type {
  SaveWritingProfileInput,
  WritingProfile,
  WritingProfileBundle,
  WritingProfileScope,
} from '../../../shared/types/domain';
import { errorDetails } from '../../../stores/support';
import { KnowledgePicker } from '../../knowledge/KnowledgePicker';
import { buildWritingProfileSnapshot, writingProfileController } from '../writingProfileController';
import styles from './WritingProfileSettings.module.css';

const emptyDraft = (scope: WritingProfileScope, workspaceId?: string): SaveWritingProfileInput => ({
  scope,
  workspaceId: scope === 'workspace' ? (workspaceId ?? null) : null,
  enabled: false,
  rules: '',
  terminology: [],
  forbiddenWords: [],
  exampleKnowledgeIds: [],
});

const toDraft = (profile: WritingProfile): SaveWritingProfileInput => ({
  scope: profile.scope,
  workspaceId: profile.workspaceId,
  enabled: profile.enabled,
  rules: profile.rules,
  terminology: profile.terminology.map((rule) => ({ ...rule })),
  forbiddenWords: [...profile.forbiddenWords],
  exampleKnowledgeIds: [...profile.exampleKnowledgeIds],
});

const draftProfile = (
  draft: SaveWritingProfileInput,
  saved: WritingProfile | null | undefined
): WritingProfile => ({
  id: draft.scope === 'global' ? 'global' : `workspace:${draft.workspaceId ?? ''}`,
  scope: draft.scope,
  workspaceId: draft.workspaceId,
  enabled: draft.enabled,
  version: (saved?.version ?? 0) + 1,
  rules: draft.rules.trim(),
  terminology: draft.terminology
    .map(({ term, preferred }) => ({ term: term.trim(), preferred: preferred.trim() }))
    .filter(({ term, preferred }) => term.length > 0 && preferred.length > 0),
  forbiddenWords: draft.forbiddenWords.map((word) => word.trim()).filter(Boolean),
  exampleKnowledgeIds: [...draft.exampleKnowledgeIds],
  updatedAt: saved?.updatedAt ?? '',
});

export function WritingProfileSettings({
  workspaceId,
  workspaceName,
}: {
  workspaceId?: string;
  workspaceName?: string;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const [scope, setScope] = useState<WritingProfileScope>('global');
  const [bundle, setBundle] = useState<WritingProfileBundle | null>(null);
  const [draft, setDraft] = useState<SaveWritingProfileInput>(() => emptyDraft('global'));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const profileForScope = useMemo(
    () => (scope === 'global' ? bundle?.global : bundle?.workspace),
    [bundle, scope]
  );
  const draftChanged = useMemo(() => {
    const savedDraft = profileForScope ? toDraft(profileForScope) : emptyDraft(scope, workspaceId);
    return JSON.stringify(draft) !== JSON.stringify(savedDraft);
  }, [draft, profileForScope, scope, workspaceId]);
  const preview = useMemo(() => {
    if (!bundle || !draftChanged) return bundle?.effective ?? null;
    const pending = draftProfile(draft, profileForScope);
    return buildWritingProfileSnapshot(
      scope === 'global' ? pending : bundle.global,
      scope === 'workspace' ? pending : bundle.workspace
    );
  }, [bundle, draft, draftChanged, profileForScope, scope]);

  useEffect(() => {
    let current = true;
    void writingProfileController
      .get(workspaceId)
      .then((output) => {
        if (!current) return;
        setScope('global');
        setBundle(output);
        setDraft(toDraft(output.global));
      })
      .catch((cause) => {
        if (current) setError(errorDetails(cause).message);
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [workspaceId]);

  const selectScope = (next: WritingProfileScope) => {
    setScope(next);
    const profile = next === 'global' ? bundle?.global : bundle?.workspace;
    setDraft(profile ? toDraft(profile) : emptyDraft(next, workspaceId));
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const output = await writingProfileController.save(draft);
      setBundle(output);
      const saved = scope === 'global' ? output.global : output.workspace;
      if (saved) setDraft(toDraft(saved));
      message.success(zh ? '写作偏好已保存' : 'Writing profile saved');
    } catch (cause) {
      setError(errorDetails(cause).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      const output = await writingProfileController.delete(scope, workspaceId);
      setBundle(output);
      const current = scope === 'global' ? output.global : output.workspace;
      setDraft(current ? toDraft(current) : emptyDraft(scope, workspaceId));
      message.success(zh ? '写作偏好已重置' : 'Writing profile reset');
    } catch (cause) {
      setError(errorDetails(cause).message);
    } finally {
      setBusy(false);
    }
  };

  if (!bundle) {
    if (busy) return <Spin />;
    return (
      <Alert
        type="error"
        showIcon
        title={error || (zh ? '写作偏好加载失败' : 'Failed to load writing profile')}
      />
    );
  }
  return (
    <section className={styles.section} aria-label={zh ? '写作方式设置' : 'Writing profile'}>
      <Segmented
        block
        value={scope}
        options={[
          { value: 'global', label: zh ? '全局偏好' : 'Global' },
          ...(workspaceId
            ? [
                {
                  value: 'workspace',
                  label: zh ? `当前工作区 · ${workspaceName ?? ''}` : 'Current workspace',
                },
              ]
            : []),
        ]}
        onChange={(value) => selectScope(value as WritingProfileScope)}
      />
      {error && <Alert type="error" showIcon title={error} />}
      <div className={styles.scopeHeader}>
        <div>
          <strong>{zh ? '启用这套偏好' : 'Enable this profile'}</strong>
          <p className={styles.muted}>
            {profileForScope
              ? draftChanged
                ? zh
                  ? '有未保存修改'
                  : 'Unsaved changes'
                : zh
                  ? '当前设置已保存'
                  : 'Current settings saved'
              : zh
                ? '尚未建立工作区覆盖，将沿用全局偏好'
                : 'No workspace override; the global profile applies'}
          </p>
        </div>
        <Switch
          checked={draft.enabled}
          onChange={(enabled) => setDraft((value) => ({ ...value, enabled }))}
        />
      </div>
      <label>
        <strong>{zh ? '写作规则' : 'Writing rules'}</strong>
        <Input.TextArea
          rows={5}
          maxLength={12000}
          showCount
          value={draft.rules}
          placeholder={
            zh
              ? '例如：先给结论；使用短句；不夸大资料未支持的事实。'
              : 'Example: lead with the conclusion; use short sentences.'
          }
          onChange={(event) => setDraft((value) => ({ ...value, rules: event.target.value }))}
        />
      </label>
      <div>
        <Space wrap>
          <strong>{zh ? '术语表' : 'Terminology'}</strong>
          <Button
            size="small"
            icon={<PlusOutlined />}
            disabled={draft.terminology.length >= 50}
            onClick={() =>
              setDraft((value) => ({
                ...value,
                terminology: [...value.terminology, { term: '', preferred: '' }],
              }))
            }
          >
            {zh ? '添加术语' : 'Add term'}
          </Button>
        </Space>
        <div className={styles.termList}>
          {draft.terminology.map((rule, index) => (
            <div className={styles.termRow} key={index}>
              <Input
                aria-label={zh ? '原术语' : 'Source term'}
                placeholder={zh ? '原术语' : 'Term'}
                value={rule.term}
                maxLength={80}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    terminology: value.terminology.map((item, position) =>
                      position === index ? { ...item, term: event.target.value } : item
                    ),
                  }))
                }
              />
              <span>→</span>
              <Input
                aria-label={zh ? '推荐写法' : 'Preferred wording'}
                placeholder={zh ? '推荐写法' : 'Preferred wording'}
                value={rule.preferred}
                maxLength={120}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    terminology: value.terminology.map((item, position) =>
                      position === index ? { ...item, preferred: event.target.value } : item
                    ),
                  }))
                }
              />
              <Button
                aria-label={zh ? '删除术语' : 'Remove term'}
                icon={<DeleteOutlined />}
                onClick={() =>
                  setDraft((value) => ({
                    ...value,
                    terminology: value.terminology.filter((_, position) => position !== index),
                  }))
                }
              />
            </div>
          ))}
        </div>
      </div>
      <label>
        <strong>{zh ? '禁用词' : 'Words to avoid'}</strong>
        <Select
          mode="tags"
          maxCount={50}
          tokenSeparators={[',', '，']}
          style={{ width: '100%' }}
          value={draft.forbiddenWords}
          placeholder={zh ? '输入后按回车，例如：赋能' : 'Type a word and press Enter'}
          onChange={(forbiddenWords) => setDraft((value) => ({ ...value, forbiddenWords }))}
        />
      </label>
      <div>
        <strong>{zh ? '范文引用' : 'Style examples'}</strong>
        <KnowledgePicker
          purpose="profile"
          maxCount={10}
          value={draft.exampleKnowledgeIds}
          onChange={(exampleKnowledgeIds) =>
            setDraft((value) => ({ ...value, exampleKnowledgeIds }))
          }
        />
        <InfoNotice
          type="info"
          showIcon
          title={
            zh
              ? '这里只保存资料引用；范文正文不会自动发送，生成时仍需在“上下文”中选择并确认。'
              : 'Only references are saved. Example content is sent only when selected and confirmed for a request.'
          }
        />
      </div>
      <div className={styles.actions}>
        <Button type="primary" icon={<SaveOutlined />} loading={busy} onClick={() => void save()}>
          {zh ? '保存偏好' : 'Save profile'}
        </Button>
        <Popconfirm
          title={zh ? '重置这套偏好？' : 'Reset this profile?'}
          onConfirm={() => void remove()}
        >
          <Button danger disabled={busy}>
            {zh ? '重置' : 'Reset'}
          </Button>
        </Popconfirm>
      </div>
      <Divider />
      <div className={styles.preview}>
        <div className={styles.previewHeader}>
          <strong>
            {draftChanged
              ? zh
                ? '保存后规则预览'
                : 'Preview after saving'
              : zh
                ? '当前有效规则预览'
                : 'Effective profile preview'}
          </strong>
          <Space wrap>
            {draftChanged && <Tag color="gold">{zh ? '未保存' : 'Unsaved'}</Tag>}
            <Tag>{preview?.composerVersion}</Tag>
            <Tag>{preview?.estimatedTokens.toLocaleString()} tokens</Tag>
          </Space>
        </div>
        {preview?.enabled ? (
          <>
            <p className={styles.muted}>
              {zh ? '应用层：' : 'Layers: '}
              {preview.layers
                .map(
                  (layer) =>
                    `${layer.scope === 'global' ? (zh ? '全局偏好' : 'Global profile') : zh ? '工作区偏好' : 'Workspace profile'}${draftChanged && layer.scope === scope ? (zh ? '（未保存）' : ' (unsaved)') : ''}`
                )
                .join(' → ')}
            </p>
            <pre>{formatWritingProfileForDisplay(preview, locale)}</pre>
          </>
        ) : (
          <p className={styles.muted}>
            {zh ? '当前未启用写作偏好，将使用任务与本次指令。' : 'No writing profile is enabled.'}
          </p>
        )}
      </div>
    </section>
  );
}
