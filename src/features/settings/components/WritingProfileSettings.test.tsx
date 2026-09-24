import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import type { WritingProfileBundle } from '../../../shared/types/domain';
import { writingProfileController } from '../writingProfileController';
import { WritingProfileSettings } from './WritingProfileSettings';

const bundle = (workspace = false): WritingProfileBundle => ({
  global: {
    id: 'global',
    scope: 'global',
    workspaceId: null,
    enabled: true,
    version: 3,
    rules: '先给结论',
    terminology: [{ term: 'AI', preferred: 'AI 助手' }],
    forbiddenWords: ['赋能'],
    exampleKnowledgeIds: ['example-1'],
    updatedAt: '2026-09-24',
  },
  workspace: workspace
    ? {
        id: 'workspace:workspace-1',
        scope: 'workspace',
        workspaceId: 'workspace-1',
        enabled: true,
        version: 1,
        rules: '面向开发者',
        terminology: [],
        forbiddenWords: [],
        exampleKnowledgeIds: [],
        updatedAt: '2026-09-24',
      }
    : null,
  effective: {
    hash: 'profile-hash',
    composerVersion: 'm2.1',
    enabled: true,
    layers: [{ id: 'global', scope: 'global', version: 3, rules: '先给结论' }],
    terminology: [{ term: 'AI', preferred: 'AI 助手' }],
    forbiddenWords: ['赋能'],
    exampleKnowledgeIds: ['example-1'],
    instructionText: 'Global Profile:\n- Rules: 先给结论',
    estimatedTokens: 18,
  },
});

afterEach(() => vi.restoreAllMocks());

it('shows the persisted version, effective snapshot and example authorization boundary', async () => {
  vi.spyOn(writingProfileController, 'get').mockResolvedValue(bundle());
  render(
    <I18nProvider>
      <WritingProfileSettings workspaceId="workspace-1" workspaceName="项目甲" />
    </I18nProvider>
  );
  expect(await screen.findByText('当前设置已保存')).toBeVisible();
  expect(screen.getByText(/全局偏好：/)).toBeVisible();
  expect(screen.queryByText(/Global Profile:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/版本 3|v3/)).not.toBeInTheDocument();
  expect(screen.getByText(/范文正文不会自动发送/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
  await waitFor(() => expect(screen.queryByText(/范文正文不会自动发送/)).not.toBeInTheDocument());
});

it('creates an isolated workspace override without rewriting the global profile', async () => {
  vi.spyOn(writingProfileController, 'get').mockResolvedValue(bundle());
  const save = vi.spyOn(writingProfileController, 'save').mockResolvedValue(bundle(true));
  render(
    <I18nProvider>
      <WritingProfileSettings workspaceId="workspace-1" workspaceName="项目甲" />
    </I18nProvider>
  );
  await screen.findByText('当前设置已保存');
  fireEvent.click(screen.getByText(/当前工作区/));
  fireEvent.change(screen.getByPlaceholderText(/先给结论/), {
    target: { value: '面向开发者' },
  });
  fireEvent.click(screen.getByRole('button', { name: /保存偏好/ }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'workspace',
        workspaceId: 'workspace-1',
        rules: '面向开发者',
      })
    )
  );
});

it('previews an enabled draft immediately instead of showing the saved zero-token snapshot', async () => {
  const disabled = bundle();
  disabled.global.enabled = false;
  disabled.effective = {
    ...disabled.effective,
    enabled: false,
    layers: [],
    terminology: [],
    forbiddenWords: [],
    exampleKnowledgeIds: [],
    instructionText: '',
    estimatedTokens: 0,
  };
  vi.spyOn(writingProfileController, 'get').mockResolvedValue(disabled);

  render(
    <I18nProvider>
      <WritingProfileSettings workspaceId="workspace-1" workspaceName="项目甲" />
    </I18nProvider>
  );

  expect(await screen.findByText('0 tokens')).toBeVisible();
  fireEvent.click(screen.getByRole('switch'));

  expect(screen.getByText('保存后规则预览')).toBeVisible();
  expect(screen.getByText('未保存')).toBeVisible();
  expect(screen.queryByText('0 tokens')).not.toBeInTheDocument();
  expect(screen.getByText(/全局偏好：/)).toBeVisible();
  expect(screen.getByText(/写作规则：先给结论/)).toBeVisible();
  expect(screen.getByText(/推荐术语：/)).toBeVisible();
  expect(screen.getByText(/避免使用：赋能/)).toBeVisible();
  expect(
    screen.queryByText(/Global Profile:|Preferred terminology|Avoid these words/)
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/版本 4|v4/)).not.toBeInTheDocument();
});
