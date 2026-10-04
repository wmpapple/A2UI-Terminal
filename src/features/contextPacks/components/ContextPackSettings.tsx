import { InfoNotice } from '../../../shared/components/InfoNotice';
import {
  CloseOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  FolderAddOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { Alert, Button, Dropdown, Input, Modal, Popconfirm, Select, Tag, Tooltip, message } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import { useImportStore } from '../../imports/importStore';
import { useContextPackStore } from '../contextPackStore';
import styles from './ContextPackSettings.module.css';
import { KnowledgePicker } from '../../knowledge/KnowledgePicker';

export function ContextPackSettings() {
  const workspaceId = useAppStore((state) => state.workspace?.id);
  return <WorkspacePacks key={workspaceId ?? 'none'} />;
}

function WorkspacePacks() {
  const { t, locale } = useI18n();
  const zh = locale === 'zh-CN';
  const workspace = useAppStore((state) => state.workspace);
  const selectWorkspace = useAppStore((state) => state.selectWorkspace);
  const forgetAuthorizedSource = useAppStore((state) => state.forgetAuthorizedSource);
  const forgetContextPack = useAppStore((state) => state.forgetContextPack);
  const sources = useImportStore((state) => state.sources).filter(
    (source) => source.workspaceId === workspace?.id
  );
  const sourceError = useImportStore((state) => state.error);
  const revokingSourceId = useImportStore((state) => state.revokingSourceId);
  const loadSources = useImportStore((state) => state.loadSources);
  const revokeSource = useImportStore((state) => state.revokeSource);
  const packs = useContextPackStore((state) => state.packs).filter(
    (pack) => pack.workspaceId === workspace?.id
  );
  const loading = useContextPackStore((state) => state.loading);
  const packError = useContextPackStore((state) => state.error);
  const loadPacks = useContextPackStore((state) => state.load);
  const createPack = useContextPackStore((state) => state.createPack);
  const deletePack = useContextPackStore((state) => state.deletePack);
  const [name, setName] = useState('');
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]);
  const [knowledgeTitles, setKnowledgeTitles] = useState<Record<string, string>>({});
  const [revokeTarget, setRevokeTarget] = useState<(typeof sources)[number] | null>(null);

  useEffect(() => {
    if (!workspace?.id) return;
    void loadSources(workspace.id);
    void loadPacks(workspace.id);
  }, [loadPacks, loadSources, workspace?.id]);

  if (!workspace) {
    return (
      <InfoNotice
        className={styles.authorizationNotice}
        type="info"
        showIcon
        title={t('contextPackWorkspaceRequired')}
        action={
          <Button onClick={() => void selectWorkspace()}>
            {zh ? '选择工作区' : 'Choose workspace'}
          </Button>
        }
      />
    );
  }

  const create = async () => {
    const created = await createPack(workspace.id, name, [...sourceIds, ...knowledgeIds]);
    if (!created) return;
    setName('');
    setSourceIds([]);
    setKnowledgeIds([]);
    message.success(t('contextPackCreated'));
  };

  return (
    <section
      className={styles.contextSection}
      aria-label={t('contextAuthorizationSettings')}
      data-testid="context-pack-settings"
    >
      <div className={styles.heading}>
        <div className={styles.kpiHeading}>
          <h2>{zh ? '资料包' : 'Source packs'}</h2>
          <Tooltip
            trigger={['hover', 'focus']}
            placement="top"
            color="#1e293b"
            styles={{
              root: { maxWidth: 'min(420px, calc(100vw - 32px))' },
              container: {
                padding: 16,
                border: '1px solid #334155',
                borderRadius: 12,
                boxShadow: '0 12px 32px #0f172a26',
                color: '#f1f5f9',
                lineHeight: 1.8,
              },
            }}
            title={t('contextPackPrivacyHint')}
          >
            <button
              type="button"
              className={styles.kpiHelp}
              aria-label={t('contextAuthorizationHelp')}
            >
              <ExclamationCircleOutlined aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <Tag>{workspace.name}</Tag>
      </div>
      <p className={styles.intro}>
        {zh
          ? '资料包是资料引用集合，不复制文件正文，可在任务中快速选择。'
          : 'Packs group source references without copying their contents, ready to use in tasks.'}
      </p>
      {packError || sourceError ? (
        <Alert type="error" showIcon title={packError ?? sourceError ?? ''} />
      ) : null}
      <div className={styles.createCard}>
        <h3>{zh ? '创建资料包' : 'Create a pack'}</h3>
        <label className={styles.stepLabel} htmlFor="context-pack-name">
          <span>1</span>{zh ? '名称' : 'Name'}
        </label>
        <Input
          id="context-pack-name"
          data-testid="context-pack-name"
          value={name}
          maxLength={80}
          placeholder={t('contextPackNamePlaceholder')}
          aria-label={t('contextPackName')}
          onChange={(event) => setName(event.target.value)}
        />
        <div className={styles.stepLabel}>
          <span>2</span>{zh ? '添加资料' : 'Add sources'}
        </div>
        <div className={styles.sourceSelectors}>
          <div>
            <label>{zh ? '工作区资料' : 'Workspace sources'}</label>
            <Select
              data-testid="context-pack-sources"
              mode="multiple"
              value={sourceIds}
              maxCount={20 - knowledgeIds.length}
              placeholder={zh ? '+ 添加工作区资料' : '+ Add workspace sources'}
              aria-label={t('contextPackSources')}
              options={sources.map((source) => ({ value: source.id, label: source.name }))}
              onChange={setSourceIds}
            />
          </div>
          <div>
            <label>{zh ? '个人资料' : 'My sources'}</label>
            <KnowledgePicker
              value={knowledgeIds}
              onChange={setKnowledgeIds}
              purpose="pack"
              maxCount={20 - sourceIds.length}
              hideLabel
              placeholder={zh ? '+ 添加个人资料' : '+ Add library sources'}
              onSourceChosen={(source) =>
                setKnowledgeTitles((current) => ({ ...current, [source.id]: source.title }))
              }
            />
          </div>
        </div>
        <div className={styles.selectedSources}>
          <strong>
            {zh ? `已选择 ${sourceIds.length + knowledgeIds.length} 项` : `${sourceIds.length + knowledgeIds.length} selected`}
          </strong>
          {sourceIds.length + knowledgeIds.length === 0 ? (
            <p>{zh ? '从上方添加资料，最多 20 项。' : 'Add up to 20 sources above.'}</p>
          ) : (
            <ul>
              {sourceIds.map((id) => (
                <li key={id}>
                  <span>{sources.find((source) => source.id === id)?.name ?? id}</span>
                  <Button type="text" icon={<CloseOutlined />} aria-label={`${zh ? '移除' : 'Remove'} ${id}`} onClick={() => setSourceIds((current) => current.filter((item) => item !== id))} />
                </li>
              ))}
              {knowledgeIds.map((id) => (
                <li key={id}>
                  <span>{knowledgeTitles[id] ?? id}</span>
                  <Button type="text" icon={<CloseOutlined />} aria-label={`${zh ? '移除' : 'Remove'} ${id}`} onClick={() => setKnowledgeIds((current) => current.filter((item) => item !== id))} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.createFooter}>
          <span>{zh ? '资料包保存在当前工作区，使用时仍需确认发送清单。' : 'Saved in this workspace; sending still requires confirmation.'}</span>
          <Button
            data-testid="create-context-pack"
            type="primary"
            icon={<FolderAddOutlined />}
            loading={loading}
            disabled={!name.trim() || sourceIds.length + knowledgeIds.length === 0 || sourceIds.length + knowledgeIds.length > 20}
            onClick={() => void create()}
          >
            {t('createContextPack')}
          </Button>
        </div>
      </div>
      <div className={styles.heading}>
        <h3>{zh ? '已有资料包' : 'Saved packs'}</h3>
        <span>{packs.length}</span>
      </div>
      <div className={styles.managedList}>
        {packs.length === 0 ? <span>{t('noContextPacks')}</span> : null}
        {packs.map((pack) => (
          <article key={pack.id} className={styles.managedItem} data-testid="context-pack-item">
            <div>
              <strong>{pack.name}</strong>
              <span>
                {pack.items
                  .map(
                    (item) =>
                      `${item.label} (${item.personalKnowledge ? (zh ? '个人资料' : 'Library') : zh ? '工作区' : 'Workspace'})`
                  )
                  .join(' · ')}
              </span>
            </div>
            <Tag>{t('contextPackItemCount').replace('{count}', String(pack.items.length))}</Tag>
            <Popconfirm
              title={t('deleteContextPackTitle').replace('{name}', pack.name)}
              description={t('deleteContextPackDescription')}
              okText={t('deleteContextPackConfirm')}
              cancelText={t('cancel')}
              okButtonProps={{ danger: true }}
              onConfirm={async () => {
                if (await deletePack(workspace.id, pack.id)) {
                  forgetContextPack(pack.id);
                  message.success(t('contextPackDeleted'));
                }
              }}
            >
              <Button
                size="small"
                icon={<DeleteOutlined />}
                data-testid="delete-context-pack"
                aria-label={t('deleteContextPack')}
                title={t('deleteContextPack')}
              />
            </Popconfirm>
          </article>
        ))}
      </div>
      <details className={styles.workspaceSources}>
        <summary>
          {zh ? `当前工作区资料 ${sources.length} 项` : `${sources.length} workspace sources`}
        </summary>
        <p>{zh ? '这里只管理当前工作区的资料授权，不会删除资料库副本或原文件。' : 'This manages workspace authorization only, not library copies or original files.'}</p>
        <div className={styles.managedList}>
          {sources.length === 0 ? <span>{t('noAuthorizedSources')}</span> : null}
          {sources.map((source) => (
            <article key={source.id} className={styles.managedItem} data-testid="authorized-source-item">
              <div>
                <strong>{source.name}</strong>
                <span>{t('sourceAuthorizationStoredInWorkspace')}</span>
              </div>
              <Tag>{t(`sourceKind${source.kind === 'table' ? 'Table' : source.kind === 'image' ? 'Image' : 'Text'}`)}</Tag>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [{ key: 'remove', label: zh ? '从当前工作区移除' : 'Remove from workspace', danger: true }],
                  onClick: () => setRevokeTarget(source),
                }}
              >
                <Button
                  data-testid="revoke-authorized-source"
                  size="small"
                  icon={<MoreOutlined />}
                  aria-label={`${zh ? '资料操作' : 'Source actions'}：${source.name}`}
                  loading={revokingSourceId === source.id}
                />
              </Dropdown>
            </article>
          ))}
        </div>
      </details>
      <Modal
        open={Boolean(revokeTarget)}
        title={revokeTarget ? t('revokeSourceTitle').replace('{name}', revokeTarget.name) : ''}
        okText={zh ? '从工作区移除' : 'Remove from workspace'}
        cancelText={t('revokeSourceCancel')}
        okButtonProps={{ danger: true, loading: Boolean(revokingSourceId) }}
        onCancel={() => setRevokeTarget(null)}
        onOk={async () => {
          if (!revokeTarget) return;
          if (await revokeSource(workspace.id, revokeTarget.id)) {
            forgetAuthorizedSource(revokeTarget.id);
            message.success(t('sourceAuthorizationRevoked'));
            setRevokeTarget(null);
          }
        }}
      >
        <p>{t('revokeSourceDescription')}</p>
        <p>{zh ? '个人资料库中的副本不受影响。' : 'Any personal library copy is unaffected.'}</p>
      </Modal>
    </section>
  );
}
