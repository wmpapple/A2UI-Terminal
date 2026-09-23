import { DeleteOutlined, ExclamationCircleOutlined, FolderAddOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Popconfirm, Select, Tag, Tooltip, message } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import { useAppStore } from '../../../stores/useAppStore';
import { useImportStore } from '../../imports/importStore';
import { useContextPackStore } from '../contextPackStore';
import styles from '../../settings/components/SystemSettings.module.css';
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

  useEffect(() => {
    if (!workspace?.id) return;
    void loadSources(workspace.id);
    void loadPacks(workspace.id);
  }, [loadPacks, loadSources, workspace?.id]);

  if (!workspace) {
    return (
      <Alert
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
          <h3>{t('contextAuthorizationSettings')}</h3>
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
      {packError || sourceError ? (
        <Alert type="error" showIcon title={packError ?? sourceError ?? ''} />
      ) : null}
      <div className={styles.packComposer}>
        <Input
          data-testid="context-pack-name"
          value={name}
          maxLength={80}
          placeholder={t('contextPackNamePlaceholder')}
          aria-label={t('contextPackName')}
          onChange={(event) => setName(event.target.value)}
        />
        <Select
          data-testid="context-pack-sources"
          mode="multiple"
          value={sourceIds}
          maxCount={20 - knowledgeIds.length}
          placeholder={t('contextPackSourcesPlaceholder')}
          aria-label={t('contextPackSources')}
          options={sources.map((source) => ({ value: source.id, label: source.name }))}
          onChange={setSourceIds}
        />
      </div>
      <KnowledgePicker
        value={knowledgeIds}
        onChange={setKnowledgeIds}
        purpose="pack"
        maxCount={20 - sourceIds.length}
      />
      <p>
        {zh
          ? '可混合选择个人资料与当前工作区资料，合计最多 20 项。资料包保存在上方标明的工作区；选择后仍需确认发送清单。'
          : 'Combine up to 20 library and workspace sources. Packs belong to the workspace shown above; sending still requires confirmation.'}
      </p>
      <Button
        data-testid="create-context-pack"
        type="primary"
        icon={<FolderAddOutlined />}
        loading={loading}
        disabled={
          !name.trim() ||
          sourceIds.length + knowledgeIds.length === 0 ||
          sourceIds.length + knowledgeIds.length > 20
        }
        onClick={() => void create()}
      >
        {t('createContextPack')}
      </Button>
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
                danger
                size="small"
                icon={<DeleteOutlined />}
                data-testid="delete-context-pack"
              >
                {t('deleteContextPack')}
              </Button>
            </Popconfirm>
          </article>
        ))}
      </div>
      <div className={styles.heading}>
        <h3>{t('authorizedSources')}</h3>
        <span>{t('sourceNotSent')}</span>
      </div>
      <div className={styles.managedList}>
        {sources.length === 0 ? <span>{t('noAuthorizedSources')}</span> : null}
        {sources.map((source) => (
          <article
            key={source.id}
            className={styles.managedItem}
            data-testid="authorized-source-item"
          >
            <div>
              <strong>{source.name}</strong>
              <span>{t('sourceAuthorizationStoredInWorkspace')}</span>
            </div>
            <Tag>
              {t(
                `sourceKind${source.kind === 'table' ? 'Table' : source.kind === 'image' ? 'Image' : 'Text'}`
              )}
            </Tag>
            <Popconfirm
              title={t('revokeSourceTitle').replace('{name}', source.name)}
              description={t('revokeSourceDescription')}
              okText={t('revokeSourceConfirm')}
              cancelText={t('revokeSourceCancel')}
              okButtonProps={{ danger: true }}
              onConfirm={async () => {
                if (await revokeSource(workspace.id, source.id)) {
                  forgetAuthorizedSource(source.id);
                  message.success(t('sourceAuthorizationRevoked'));
                }
              }}
            >
              <Button
                data-testid="revoke-authorized-source"
                danger
                size="small"
                icon={<DeleteOutlined />}
                loading={revokingSourceId === source.id}
              >
                {t('revokeSource')}
              </Button>
            </Popconfirm>
          </article>
        ))}
      </div>
    </section>
  );
}
