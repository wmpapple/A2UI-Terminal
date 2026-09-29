import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import { useAppStore } from '../../stores/useAppStore';
import type { DocumentSnapshot } from '../../shared/types/document';
import { CriticPanel } from './CriticPanel';
import { criticController as api } from './criticController';
import { inlineEditController } from '../selection/inlineEditController';

const snapshot: DocumentSnapshot = {
  target: { kind: 'result', resultId: 'critic-result' },
  revisionId: 'r1',
  contentHash: 'h1',
  format: 'markdown',
  text: '# 标题\n\n预算 420 元。',
  editable: true,
  hasUnsavedDraft: false,
};
describe('CriticPanel', () => {
  it('explains why a pasted fenced article has no forbidden-word findings', async () => {
    render(
      <I18nProvider>
        <CriticPanel
          snapshot={{ ...snapshot, text: '   ```markdown\n   我们希望赋能团队。\n   ```\n' }}
          workspaceId="web-mock-workspace"
          onApplied={vi.fn()}
        />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: '文档审稿' }));
    expect(await screen.findByText(/正文似乎被代码块标记包裹/)).toBeInTheDocument();
  });
  it('offers review for plain-text results', () => {
    render(
      <I18nProvider>
        <CriticPanel
          snapshot={{ ...snapshot, format: 'plain_text' }}
          workspaceId="web-mock-workspace"
          onApplied={vi.fn()}
        />
      </I18nProvider>
    );
    expect(screen.getByRole('button', { name: '文档审稿' })).toBeInTheDocument();
  });
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ runtimeMode: 'web-mock', activeProviderId: 'local' });
  });
  afterEach(() => vi.restoreAllMocks());
  const tree = (s = snapshot, onApplied = vi.fn()) => (
    <I18nProvider>
      <CriticPanel snapshot={s} workspaceId="web-mock-workspace" onApplied={onApplied} />
    </I18nProvider>
  );
  const open = async () => {
    fireEvent.click(screen.getByRole('button', { name: '文档审稿' }));
    await screen.findByText('数字来源待核对');
  };
  it('local inspection and ignored state do not trigger AI requests or document writes', async () => {
    const plan = vi.spyOn(api, 'plan'),
      applied = vi.fn();
    render(tree(snapshot, applied));
    await open();
    fireEvent.click(screen.getByRole('button', { name: /忽\s*略/ }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '让 AI 修改' })).not.toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('checkbox', { name: '显示已忽略提示' }));
    await screen.findByRole('button', { name: '恢复提示' });
    expect(screen.getByRole('button', { name: '让 AI 修改' })).toBeDisabled();
    expect(plan).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
  });
  it('dirty snapshots immediately disable old findings and AI planning', async () => {
    const { rerender } = render(tree());
    await open();
    rerender(tree({ ...snapshot, hasUnsavedDraft: true }));
    expect(screen.queryByRole('button', { name: '让 AI 修改' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 深度审稿' })).toBeDisabled();
    expect(screen.getByText(/正文未保存，旧提示已停用/)).toBeInTheDocument();
  });
  it('deep review waits for confirmation and never invokes apply', async () => {
    const start = vi.spyOn(api, 'start'),
      applied = vi.fn();
    render(tree(snapshot, applied));
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'AI 深度审稿' }));
    await screen.findByText('确认本次审稿发送范围');
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认并开始' }));
    await screen.findByText('AI 建议（待人工核对）');
    expect(start).toHaveBeenCalledTimes(1);
    expect(applied).not.toHaveBeenCalled();
  });
  it('a finding creates a proposal but writes only after explicit acceptance', async () => {
    const start = vi.spyOn(inlineEditController, 'start'),
      accept = vi.spyOn(inlineEditController, 'accept'),
      applied = vi.fn();
    render(tree(snapshot, applied));
    await open();
    fireEvent.click(screen.getByRole('button', { name: '让 AI 修改' }));
    await screen.findByText('确认本次审稿发送范围');
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认并开始' }));
    await screen.findByText('审阅修改提案');
    expect(accept).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '接受并写入' }));
    await waitFor(() => expect(applied).toHaveBeenCalledTimes(1));
  });
  it('navigation to another target hides a pending confirmation', async () => {
    const start = vi.spyOn(api, 'start');
    const { rerender } = render(tree());
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'AI 深度审稿' }));
    await screen.findByText('确认本次审稿发送范围');
    rerender(tree({ ...snapshot, target: { kind: 'result', resultId: 'other' } }));
    await waitFor(() => expect(screen.queryByText('确认本次审稿发送范围')).not.toBeVisible());
    expect(start).not.toHaveBeenCalled();
  });
});
