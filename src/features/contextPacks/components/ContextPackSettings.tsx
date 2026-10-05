import { InfoNotice } from '../../../shared/components/InfoNotice';
import {
  CloseOutlined,
  ExclamationCircleOutlined,
  FileOutlined,
  FolderAddOutlined,
  MoreOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { Alert, Button, Drawer, Dropdown, Input, Modal, Tag, Tooltip, message } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import { useImportStore } from '../../imports/importStore';
import { useContextPackStore } from '../contextPackStore';
import styles from './ContextPackSettings.module.css';
import { PackSourcePicker } from './PackSourcePicker';

const packDate = (value: string, locale: string, zh: boolean) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toDateString() === new Date().toDateString()
    ? (zh ? '今天更新' : 'Updated today')
    : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
};

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
  const [creating, setCreating] = useState(false);
  const [expandedPackId, setExpandedPackId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<(typeof packs)[number] | null>(null);
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

  const workspaceContextLabel = workspace.kind === 'standalone'
    ? (zh ? `当前工作区资料：${sources.length} 项` : `Workspace sources: ${sources.length}`)
    : `${zh ? '当前工作区：' : 'Workspace: '}${workspace.name.trim() || (zh ? '未命名工作区' : 'Untitled workspace')}`;

  const create = async () => {
    const created = await createPack(workspace.id, name, [...sourceIds, ...knowledgeIds]);
    if (!created) return;
    setName('');
    setSourceIds([]);
    setKnowledgeIds([]);
    setCreating(false);
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
        <span className={styles.workspaceScope} title={workspaceContextLabel}>
          {workspaceContextLabel}
        </span>
      </div>
      <p className={styles.intro}>
        {zh
          ? '把常一起使用的资料组合起来，方便任务中一次选择。'
          : 'Group sources you use together and select them in one step for a task.'}
      </p>
      <p className={styles.scopeNote}>{zh ? '仅保存引用，不复制正文。' : 'References only; contents are not copied.'}</p>
      {packError || sourceError ? (
        <Alert type="error" showIcon title={packError ?? sourceError ?? ''} />
      ) : null}
      <div className={styles.packActions}>
        <Button type="primary" icon={<PlusOutlined />} aria-label={zh ? '新建资料包' : 'New pack'} onClick={() => setCreating(true)}>
          {zh ? '新建资料包' : 'New pack'}
        </Button>
      </div>
      <div className={`${styles.managedList} ${styles.packList}`}>
        {packs.length === 0 ? (
          <div className={styles.emptyPacks} data-testid="pack-empty">
            <FolderAddOutlined aria-hidden="true" />
            <strong>{t('noContextPacks')}</strong>
            <span>{zh ? '把经常一起使用的资料组合起来，以后可以在任务中一次选择整组资料。' : 'Group sources you use together and select them in one step for a task.'}</span>
          </div>
        ) : null}
        {packs.map((pack) => (
          <article key={pack.id} className={styles.managedItem} data-testid="context-pack-item">
            <div className={styles.packIcon}><FolderAddOutlined aria-hidden="true" /></div>
            <div className={styles.packBody}>
              <strong>{pack.name}</strong>
              <span>{t('contextPackItemCount').replace('{count}', String(pack.items.length))}</span>
              <span>{pack.items.slice(0, 3).map((item) => item.label).join(' · ')}{pack.items.length > 3 ? ` +${pack.items.length - 3}` : ''}</span>
              {expandedPackId === pack.id && (
                <ul className={styles.packDetails}>
                  {pack.items.map((item) => (
                    <li key={item.sourceId}>{item.label} · {item.personalKnowledge ? (zh ? '个人资料' : 'Library') : (zh ? '工作区' : 'Workspace')}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className={styles.packItemActions}>
              <span className={styles.packUpdated}>{packDate(pack.updatedAt, locale, zh)}</span>
              <Button type="text" aria-expanded={expandedPackId === pack.id} onClick={() => setExpandedPackId((current) => current === pack.id ? null : pack.id)}>
                {expandedPackId === pack.id ? (zh ? '收起' : 'Close') : (zh ? '打开' : 'Open')}
              </Button>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [{ key: 'delete', label: t('deleteContextPack'), danger: true }],
                  onClick: () => setDeleteTarget(pack),
                }}
              >
                <Button size="small" type="text" icon={<MoreOutlined />} data-testid="pack-actions" aria-label={`${zh ? '资料包操作' : 'Pack actions'}：${pack.name}`} />
              </Dropdown>
            </div>
          </article>
        ))}
      </div>
      <details className={styles.workspaceSources}>
        <summary>
          {zh ? `当前工作区资料（${sources.length}）` : `Workspace sources (${sources.length})`}
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
                <Button data-testid="revoke-authorized-source" size="small" icon={<MoreOutlined />} aria-label={`${zh ? '资料操作' : 'Source actions'}：${source.name}`} loading={revokingSourceId === source.id} />
              </Dropdown>
            </article>
          ))}
        </div>
      </details>
      <Drawer
        title={zh ? '新建资料包' : 'New pack'}
        open={creating}
        onClose={() => setCreating(false)}
        size={480}
      >
      <div className={styles.createCard}>
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
          <PackSourcePicker
            kind="workspace"
            workspaceSources={sources}
            value={sourceIds}
            totalSelected={sourceIds.length + knowledgeIds.length}
            onChange={setSourceIds}
          />
          <PackSourcePicker
            kind="personal"
            workspaceSources={sources}
            value={knowledgeIds}
            totalSelected={sourceIds.length + knowledgeIds.length}
            onChange={setKnowledgeIds}
            onPersonalSourceChosen={(source) =>
              setKnowledgeTitles((current) => ({ ...current, [source.id]: source.title }))
            }
          />
        </div>
        <div className={styles.selectedSources}>
          <div className={styles.selectedHeading}>
            <strong>{zh ? `已选择 ${sourceIds.length + knowledgeIds.length} 项` : `${sourceIds.length + knowledgeIds.length} selected`}</strong>
            <span>{zh ? '最多 20 项' : 'Up to 20'}</span>
          </div>
          {sourceIds.length + knowledgeIds.length === 0 ? (
            <p>{zh ? '从上方添加资料，最多 20 项。' : 'Add up to 20 sources above.'}</p>
          ) : (
            <ul>
              {sourceIds.map((id) => (
                <li key={id}>
                  <FileOutlined aria-hidden="true" />
                  <span>{sources.find((source) => source.id === id)?.name ?? id}</span>
                  <Button type="text" icon={<CloseOutlined />} aria-label={`${zh ? '移除' : 'Remove'} ${sources.find((source) => source.id === id)?.name ?? id}`} onClick={() => setSourceIds((current) => current.filter((item) => item !== id))} />
                </li>
              ))}
              {knowledgeIds.map((id) => (
                <li key={id}>
                  <FileOutlined aria-hidden="true" />
                  <span>{knowledgeTitles[id] ?? id}</span>
                  <Button type="text" icon={<CloseOutlined />} aria-label={`${zh ? '移除' : 'Remove'} ${knowledgeTitles[id] ?? id}`} onClick={() => setKnowledgeIds((current) => current.filter((item) => item !== id))} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.createFooter}>
          <span>{zh ? '资料包属于当前工作区，只引用资料，不复制正文；使用时仍需确认发送清单。' : 'Packs belong to this workspace and reference sources without copying them; sending still requires confirmation.'}</span>
          <Button onClick={() => setCreating(false)}>{t('cancel')}</Button>
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
      </Drawer>
      <Modal
        open={Boolean(deleteTarget)}
        title={deleteTarget ? t('deleteContextPackTitle').replace('{name}', deleteTarget.name) : ''}
        okText={t('deleteContextPackConfirm')}
        cancelText={t('cancel')}
        okButtonProps={{ danger: true, loading }}
        onCancel={() => setDeleteTarget(null)}
        onOk={async () => {
          if (!deleteTarget) return;
          if (await deletePack(workspace.id, deleteTarget.id)) {
            forgetContextPack(deleteTarget.id);
            setDeleteTarget(null);
            message.success(t('contextPackDeleted'));
          }
        }}
      >
        <p>{t('deleteContextPackDescription')}</p>
      </Modal>
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
