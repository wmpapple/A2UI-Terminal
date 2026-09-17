import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import taskFixture from '../../../../contracts/v2/task.json';
import resultFixture from '../../../../contracts/v2/result.json';
import type { ResultSummary, TaskTemplate } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { homeInitialState, useHomeStore } from '../homeStore';
import { homeController } from '../homeController';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  const template = taskFixture.template as unknown as TaskTemplate;
  const recentResult = resultFixture.summary as unknown as ResultSummary;

  beforeEach(() => {
    vi.restoreAllMocks();
    useHomeStore.setState({
      ...homeInitialState,
      initialized: true,
      templates: [template],
      recentResults: [recentResult],
      initialize: vi.fn().mockResolvedValue(undefined),
      beginTask: vi.fn().mockResolvedValue(undefined),
      createLocalScaffold: vi.fn().mockResolvedValue(undefined),
      resetTask: vi.fn(),
      clearError: vi.fn(),
    });
    useAppStore.setState({
      runtimeMode: 'web-mock',
      workspace: null,
      workspaceError: null,
      workspaceLoading: false,
    });
  });

  it('shows exactly six fixed task categories and Result-based recents', () => {
    render(
      <I18nProvider>
        <HomePage onOpenWorkbench={vi.fn()} onOpenGuide={vi.fn()} />
      </I18nProvider>
    );

    expect(screen.getByRole('heading', { name: '今天想完成什么？' })).toBeVisible();
    expect(screen.getByText('六类固定入口')).toBeVisible();
    for (const label of [
      '写一份文档',
      '修改已有文件',
      '整理一组资料',
      '分析表格或数据',
      '制作表单 / 清单 / 小工具',
      '自由描述任务',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeVisible();
    }
    expect(screen.getByText(recentResult.title)).toBeVisible();
    expect(screen.getByText('不按聊天会话组织')).toBeVisible();
  });

  it('opens the validated meeting template through the shared Home store', () => {
    const beginTask = vi.fn().mockResolvedValue(undefined);
    useHomeStore.setState({
      templates: [template],
      beginTask,
    });
    render(
      <I18nProvider>
        <HomePage onOpenWorkbench={vi.fn()} onOpenGuide={vi.fn()} />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /整理一组资料/ }));
    fireEvent.click(screen.getByRole('button', { name: /会议纪要/ }));
    expect(beginTask).toHaveBeenCalledWith('web-mock-workspace', 'meeting_minutes');
    expect(
      within(screen.getByRole('dialog')).getByText('当前只创建本地结构草稿，尚未调用 AI 生成正文。')
    ).toBeInTheDocument();
  });

  it('does not pretend later table or trusted-tool capabilities are available', () => {
    render(
      <I18nProvider>
        <HomePage onOpenWorkbench={vi.fn()} onOpenGuide={vi.fn()} />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /分析表格或数据/ }));
    expect(screen.getByText(/当前不会伪装已读取数据/)).toBeVisible();
  });

  it('opens a result returned by the authorized local search', async () => {
    const onOpenWorkbench = vi.fn();
    vi.spyOn(homeController, 'search').mockResolvedValue({
      query: '调研',
      items: [
        {
          id: recentResult.id,
          kind: 'result',
          title: recentResult.title,
          snippet: '调研正文中的匹配内容',
          updatedAt: recentResult.updatedAt,
          score: 2,
        },
      ],
      indexedDocuments: 1,
      skippedDocuments: 0,
      indexMode: 'memory_lexical',
    });
    render(
      <I18nProvider>
        <HomePage onOpenWorkbench={onOpenWorkbench} onOpenGuide={vi.fn()} />
      </I18nProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('输入成果标题、正文关键词或资料名称'), {
      target: { value: '调研' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^搜\s*索$/ }));
    await waitFor(() => expect(screen.getByText('调研正文中的匹配内容')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: /打开成果/ }));
    expect(onOpenWorkbench).toHaveBeenCalledWith(recentResult.id);
  });

  it('adds an authorized source to the send list without sending it', async () => {
    useAppStore.setState({
      workspace: { id: 'workspace-search', name: 'Search', available: true, kind: 'standalone' },
      activeSessionId: 'session-search',
      contextBySession: {},
      contextReviewKeyBySession: {},
    });
    vi.spyOn(homeController, 'search').mockResolvedValue({
      query: '会议',
      items: [
        {
          id: 'source-meeting',
          kind: 'document_source',
          title: 'meeting.md',
          snippet: '会议资料',
          updatedAt: null,
          score: 1,
        },
      ],
      indexedDocuments: 1,
      skippedDocuments: 0,
      indexMode: 'memory_lexical',
    });
    const onOpenWorkbench = vi.fn();
    render(
      <I18nProvider>
        <HomePage onOpenWorkbench={onOpenWorkbench} onOpenGuide={vi.fn()} />
      </I18nProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('输入成果标题、正文关键词或资料名称'), {
      target: { value: '会议' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^搜\s*索$/ }));
    await waitFor(() => expect(screen.getByText('会议资料')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: /用此资料开始任务/ }));

    expect(useAppStore.getState().contextBySession['session-search'].documentSourceIds).toEqual([
      'source-meeting',
    ]);
    expect(useAppStore.getState().contextReviewKeyBySession['session-search']).toBe(
      'search-selection-needs-review'
    );
    expect(onOpenWorkbench).toHaveBeenCalledWith();
  });
});
