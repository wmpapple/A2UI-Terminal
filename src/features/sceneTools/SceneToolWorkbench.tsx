import {
  CheckCircleFilled,
  CheckOutlined,
  EllipsisOutlined,
  ExclamationCircleFilled,
  LoadingOutlined,
} from '@ant-design/icons';
import { Alert, Button, Dropdown, Input, Modal, Popconfirm, Spin } from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import { findA2uiNode } from '../../stores/support';
import type { ResultDocument } from '../../shared/types/domain';
import { a2uiController } from '../a2ui/a2uiController';
import { A2uiRuntime } from '../a2ui/runtime/A2uiRuntime';
import { ExportResultModal } from '../results/components/ExportResultModal';
import { resultController } from '../results/resultController';
import { useResultStore } from '../results/resultStore';
import { groupSceneToolSurface } from './groupSceneToolSurface';
import type { SceneToolManageAction } from './MySceneTools';
import { sceneTools, useSceneToolStore } from './sceneToolStore';
import { ToolBindingPanel } from './ToolBindingPanel';
import styles from './SceneTools.module.css';

const templateLabel = (id: string, zh: boolean) => {
  const labels: Record<string, [string, string]> = {
    publish: ['发布检查表', 'Publication checklist'],
    interview: ['采访提纲', 'Interview guide'],
    review: ['文档审核表', 'Document review'],
    tasks: ['任务清单', 'Task list'],
    collect: ['信息收集表', 'Information form'],
    legacy: ['自定义工具', 'Custom tool'],
  };
  return labels[id]?.[zh ? 0 : 1] ?? (zh ? '个人模板' : 'Personal template');
};

const suggestedPublicationTitle = (toolTitle: string, templateId: string, zh: boolean) => {
  const names: Record<string, [string, string]> = {
    publish: ['发布检查结果', 'Publication check result'],
    interview: ['采访记录', 'Interview record'],
    review: ['文档审核报告', 'Document review report'],
    tasks: ['任务执行报告', 'Task progress report'],
    collect: ['信息收集结果', 'Collected information'],
  };
  const resultName = names[templateId]?.[zh ? 0 : 1] ?? (zh ? '工具成果' : 'Tool result');
  return toolTitle === templateLabel(templateId, zh) ? resultName : `${toolTitle} · ${resultName}`;
};

export function SceneToolWorkbench({
  resultId,
  onOpenResult,
  onDeleted,
  professional = false,
  requestedAction,
  onRequestedActionHandled,
}: {
  resultId: string;
  onOpenResult: (id: string) => void;
  onDeleted: (id: string) => void;
  professional?: boolean;
  requestedAction?: SceneToolManageAction | null;
  onRequestedActionHandled?: () => void;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const state = useSceneToolStore((s) => s.entries[resultId]);
  const [exportOpen, setExportOpen] = useState(false);
  const [publicationName, setPublicationName] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [renameName, setRenameName] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [document, setDocument] = useState<ResultDocument | null>(null);

  useEffect(() => {
    void sceneTools.load(resultId);
  }, [resultId]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (useSceneToolStore.getState().entries[resultId]?.dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [resultId]);

  const view = state?.view;
  const groupedSurface = view ? groupSceneToolSurface(view.surface, view.templateId, zh) : null;
  const publication = view?.publication;
  const publicationSynced = Boolean(publication?.synced && !state?.dirty && !state?.saving);
  const savedAt = view?.result.updatedAt
    ? new Date(view.result.updatedAt).toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const autosave = state?.error
    ? {
        icon: <ExclamationCircleFilled />,
        text: zh ? '自动保存失败' : 'Autosave failed',
        tone: 'error',
      }
    : state?.saving || state?.dirty
      ? {
          icon: <LoadingOutlined spin />,
          text: zh ? '正在保存' : 'Saving',
          tone: 'saving',
        }
      : {
          icon: <CheckOutlined />,
          text: zh
            ? `已自动保存${savedAt ? ` · ${savedAt}` : ''}`
            : `Autosaved${savedAt ? ` · ${savedAt}` : ''}`,
          tone: 'saved',
        };

  useEffect(() => {
    if (!view || !requestedAction) return;
    const timer = window.setTimeout(() => {
      if (requestedAction === 'template') setTemplateName(view.result.title);
      if (requestedAction === 'rename') setRenameName(view.result.title);
      if (requestedAction === 'binding')
        window.dispatchEvent(new CustomEvent('scene-tool-change-binding', { detail: resultId }));
      onRequestedActionHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onRequestedActionHandled, requestedAction, resultId, view]);

  const publish = async (title?: string) => {
    setBusy(true);
    setError(null);
    try {
      if (await sceneTools.publish(resultId, title)) {
        setPublicationName(null);
        await useResultStore.getState().loadResults();
      }
    } finally {
      setBusy(false);
    }
  };

  const menuItems: MenuProps['items'] = [
    { key: 'template', label: zh ? '保存为个人模板' : 'Save as personal template' },
    { key: 'rename', label: zh ? '重命名' : 'Rename' },
    { key: 'binding', label: zh ? '更换关联对象' : 'Change linked target' },
    { type: 'divider' },
    { key: 'reset', label: zh ? '重置工具' : 'Reset tool' },
    { key: 'delete', label: zh ? '删除工具' : 'Delete tool', danger: true },
  ];
  const selectMenu: MenuProps['onClick'] = ({ key }) => {
    if (!view) return;
    if (key === 'template') setTemplateName(view.result.title);
    if (key === 'rename') setRenameName(view.result.title);
    if (key === 'binding')
      window.dispatchEvent(new CustomEvent('scene-tool-change-binding', { detail: resultId }));
    if (key === 'reset') setResetOpen(true);
    if (key === 'delete') setDeleteOpen(true);
  };

  return (
    <section className={styles.page} aria-label={zh ? '场景工具工作台' : 'Scene tool workbench'}>
      {!view && !state?.error ? <Spin /> : null}
      {view ? (
        <div className={styles.body}>
          <header className={styles.toolHeader}>
            <div>
              <h1>{view.result.title}</h1>
              <p>
                {zh ? '场景工具 · 来自「' : 'Scene tool · From “'}
                {templateLabel(view.templateId, zh)}
                {zh ? '」模板' : '” template'}
              </p>
            </div>
          </header>

          <ToolBindingPanel
            key={resultId}
            toolResultId={resultId}
            toolStateHash={view.stateHash}
            dirty={Boolean(state.dirty || state.saving || exportOpen)}
            professional={professional}
            onOpenDocument={(id) => {
              void sceneTools.save(resultId).then((saved) => {
                if (saved) onOpenResult(id);
              });
            }}
          />

          {publication ? (
            <div className={styles.publicationRelation}>
              <span>
                {zh ? '已关联成果：' : 'Linked result: '}
                <strong>{publication.title}</strong> · Rev {publication.revisionNumber}
              </span>
              <Button type="link" onClick={() => onOpenResult(publication.resultId)}>
                {zh ? '查看成果' : 'View result'}
              </Button>
            </div>
          ) : null}

          <div className={styles.actionBar}>
            <span className={styles.autosaveStatus} data-tone={autosave.tone} role="status">
              {autosave.icon}
              {autosave.text}
            </span>
            <div className={styles.primaryActions}>
              {publicationSynced ? (
                <span className={styles.syncedStatus} role="status">
                  <CheckCircleFilled />
                  {zh ? '已同步到成果' : 'Synced to result'} · Rev {publication!.revisionNumber}
                </span>
              ) : (
                <>
                  {publication ? (
                    <span className={styles.publicationPending} role="status">
                      {zh ? '● 工具内容有更新' : '● Tool content changed'}
                    </span>
                  ) : null}
                  <Button
                    type="primary"
                    disabled={busy || state.saving || state.conflict}
                    loading={busy}
                    onClick={() =>
                      publication
                        ? void publish()
                        : setPublicationName(
                            suggestedPublicationTitle(view.result.title, view.templateId, zh)
                          )
                    }
                  >
                    {!publication
                      ? zh
                        ? '保存为成果'
                        : 'Save as result'
                      : zh
                        ? '更新成果'
                        : 'Update result'}
                  </Button>
                </>
              )}
              <Button
                disabled={busy || state.saving || state.conflict}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    if (await sceneTools.save(resultId)) {
                      setDocument(await resultController.open(resultId));
                      setExportOpen(true);
                    }
                  } catch (reason) {
                    setError(
                      reason && typeof reason === 'object' && 'message' in reason
                        ? String(reason.message)
                        : String(reason)
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {zh ? '导出' : 'Export'}
              </Button>
              <Dropdown menu={{ items: menuItems, onClick: selectMenu }} trigger={['click']}>
                <Button
                  aria-label={zh ? '更多工具操作' : 'More tool actions'}
                  icon={<EllipsisOutlined />}
                  disabled={busy}
                />
              </Dropdown>
            </div>
          </div>

          {state?.error ? (
            <Alert
              type="error"
              showIcon
              title={
                state.conflict
                  ? zh
                    ? '内容已在其他页面更新。当前输入仍保留，请复制需要的内容后重新读取。'
                    : 'This tool changed elsewhere. Your entries are retained. Copy needed text before reloading.'
                  : state.error
              }
              action={
                <Popconfirm
                  title={
                    zh ? '放弃当前未保存输入并重新读取？' : 'Discard unsaved entries and reload?'
                  }
                  onConfirm={() => void sceneTools.load(resultId, true)}
                >
                  <Button disabled={state.saving}>{zh ? '重新读取' : 'Reload'}</Button>
                </Popconfirm>
              }
            />
          ) : null}
          {error ? (
            <Alert type="error" showIcon title={error} closable onClose={() => setError(null)} />
          ) : null}

          <div className={styles.formArea}>
            <A2uiRuntime
              locale={locale}
              className={styles.sceneSurface}
              surface={{ ...groupedSurface!, data: state.data }}
              disabled={exportOpen || busy}
              onAction={(id, event, value) => {
                const action = findA2uiNode(view.surface.root, id)?.actions[event];
                if (action?.type === 'set_state' && action.target)
                  sceneTools.change(resultId, action.target, value);
                else
                  setError(
                    zh
                      ? '此处仅支持本机填写。文件修改请使用工作区中的审阅流程。'
                      : 'Only local input is available here. Use the workspace review flow for file changes.'
                  );
              }}
            />
          </div>
        </div>
      ) : null}

      {exportOpen && document?.result.id === resultId ? (
        <ExportResultModal document={document} onClose={() => setExportOpen(false)} />
      ) : null}

      <Modal
        title={zh ? '保存为成果' : 'Save as result'}
        open={publicationName !== null}
        confirmLoading={busy}
        okText={zh ? '保存为成果' : 'Save result'}
        okButtonProps={{ disabled: !publicationName?.trim() }}
        onCancel={() => {
          if (!busy) setPublicationName(null);
        }}
        onOk={() => {
          if (publicationName?.trim() && !busy) void publish(publicationName.trim());
        }}
      >
        <Input
          aria-label={zh ? '成果名称' : 'Result name'}
          value={publicationName ?? ''}
          maxLength={160}
          onChange={(event) => setPublicationName(event.target.value)}
        />
      </Modal>

      <Modal
        title={zh ? '保存为个人模板' : 'Save as template'}
        open={templateName !== null}
        confirmLoading={busy}
        okText={zh ? '保存模板' : 'Save template'}
        cancelText={zh ? '取消' : 'Cancel'}
        okButtonProps={{ disabled: !templateName?.trim() }}
        onCancel={() => {
          if (!busy) setTemplateName(null);
        }}
        onOk={async () => {
          if (!templateName?.trim() || busy) return;
          setBusy(true);
          try {
            if (await sceneTools.save(resultId)) {
              await a2uiController.saveTemplate(
                view!.surface.workspaceId,
                view!.surface.surfaceId,
                templateName
              );
              setTemplateName(null);
            }
          } catch (reason) {
            setError(
              reason && typeof reason === 'object' && 'message' in reason
                ? String(reason.message)
                : String(reason)
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {zh
            ? '保存字段结构并清除本次填写值和关联对象。'
            : 'Saves field structure while clearing entries and the linked target.'}
        </p>
        <Input
          aria-label={zh ? '模板名称' : 'Template name'}
          maxLength={80}
          value={templateName ?? ''}
          onChange={(event) => setTemplateName(event.target.value)}
        />
      </Modal>

      <Modal
        title={zh ? '重命名工具' : 'Rename tool'}
        open={renameName !== null}
        confirmLoading={busy}
        okText={zh ? '保存名称' : 'Save name'}
        cancelText={zh ? '取消' : 'Cancel'}
        okButtonProps={{ disabled: !renameName?.trim() }}
        onCancel={() => {
          if (!busy) setRenameName(null);
        }}
        onOk={async () => {
          if (!renameName?.trim() || busy) return;
          setBusy(true);
          if (await sceneTools.rename(resultId, renameName)) setRenameName(null);
          setBusy(false);
        }}
      >
        <Input
          autoFocus
          aria-label={zh ? '工具名称' : 'Tool name'}
          maxLength={160}
          value={renameName ?? ''}
          onChange={(event) => setRenameName(event.target.value)}
        />
      </Modal>

      <Modal
        title={zh ? '重置工具？' : 'Reset tool?'}
        open={resetOpen}
        confirmLoading={busy}
        okText={zh ? '重置' : 'Reset'}
        cancelText={zh ? '取消' : 'Cancel'}
        okButtonProps={{ danger: true }}
        onCancel={() => {
          if (!busy) setResetOpen(false);
        }}
        onOk={async () => {
          setBusy(true);
          if (await sceneTools.reset(resultId)) setResetOpen(false);
          setBusy(false);
        }}
      >
        {zh
          ? '清空当前填写内容并保留工具、关联对象和已经手动保存的成果。'
          : 'Clears current entries and keeps the tool, linked target and published result.'}
      </Modal>

      <Modal
        title={zh ? '删除工具？' : 'Delete tool?'}
        open={deleteOpen}
        confirmLoading={busy}
        okText={zh ? '删除' : 'Delete'}
        cancelText={zh ? '取消' : 'Cancel'}
        okButtonProps={{ danger: true }}
        onCancel={() => {
          if (!busy) setDeleteOpen(false);
        }}
        onOk={async () => {
          setBusy(true);
          if (await sceneTools.delete(resultId)) onDeleted(resultId);
          setBusy(false);
        }}
      >
        {zh
          ? '工具填写状态将被删除；已经手动保存的成果会保留。'
          : 'The tool state will be deleted. Published results are kept.'}
      </Modal>
    </section>
  );
}
