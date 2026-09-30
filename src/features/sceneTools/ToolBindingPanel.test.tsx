import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import type { SceneLinkView } from '../../shared/types/sceneTool';
import { sceneToolController } from './sceneToolController';
import { ToolBindingPanel } from './ToolBindingPanel';

afterEach(() => vi.restoreAllMocks());

const unbound: SceneLinkView = {
  link: null,
  bindingPolicy: 'optional',
  context: null,
  status: 'unbound',
  currentHash: null,
  currentRevisionId: null,
  toolStateHash: 'hash',
  citations: [],
  critics: [],
  evidenceError: false,
};

it('keeps an independent tool binding summary compact and hides manual refresh in simple mode', async () => {
  vi.spyOn(sceneToolController, 'readLink').mockResolvedValue(unbound);
  const { rerender } = render(
    <I18nProvider>
      <ToolBindingPanel
        toolResultId="tool"
        toolStateHash="hash"
        dirty={false}
        onOpenDocument={vi.fn()}
      />
    </I18nProvider>
  );
  expect(await screen.findByText('未关联对象 · 可独立使用')).toBeVisible();
  expect(screen.getByRole('button', { name: '关联对象' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '刷新关联状态' })).not.toBeInTheDocument();
  expect(screen.queryByText(/此工具可独立填写/)).not.toBeInTheDocument();

  rerender(
    <I18nProvider>
      <ToolBindingPanel
        toolResultId="tool"
        toolStateHash="hash"
        dirty={false}
        onOpenDocument={vi.fn()}
        professional
      />
    </I18nProvider>
  );
  expect(await screen.findByRole('button', { name: '刷新关联状态' })).toBeVisible();
});

it('describes a linked target with product-facing current and changed states', async () => {
  const linked: SceneLinkView = {
    ...unbound,
    link: {
      binding: { type: 'result', targetId: 'prd' },
      targetTitle: 'PRD.md',
      boundHash: 'hash',
      boundRevisionId: 'revision',
      version: 'version',
      reviewedHash: 'hash',
      reviewedRevisionId: 'revision',
      reviewedAt: new Date().toISOString(),
    },
    status: 'current',
    currentHash: 'hash',
    currentRevisionId: 'revision',
  };
  vi.spyOn(sceneToolController, 'readLink').mockResolvedValue(linked);
  const { rerender } = render(
    <I18nProvider>
      <ToolBindingPanel
        toolResultId="tool"
        toolStateHash="hash"
        dirty={false}
        onOpenDocument={vi.fn()}
      />
    </I18nProvider>
  );
  expect(await screen.findByText('关联：PRD.md · 正常')).toBeVisible();

  vi.mocked(sceneToolController.readLink).mockResolvedValue({ ...linked, status: 'changed' });
  rerender(
    <I18nProvider>
      <ToolBindingPanel
        toolResultId="changed-tool"
        toolStateHash="hash"
        dirty={false}
        onOpenDocument={vi.fn()}
      />
    </I18nProvider>
  );
  expect(await screen.findByText('关联：PRD.md · 已更新')).toBeVisible();
  expect(screen.getByRole('button', { name: '重新核对' })).toBeVisible();
});
