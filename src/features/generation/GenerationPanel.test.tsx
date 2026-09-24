import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import fixture from '../../../contracts/v2/context-manifest.json';
import type { ChatStreamEvent, ContextManifest } from '../../shared/types/domain';
import type { GenerationOutput } from '../../shared/types/generation';
import { generationController } from './generationController';
import { contextPackController } from '../contextPacks/contextPackController';
import { importController } from '../imports/importController';
import { GenerationPanel } from './GenerationPanel';
import { clearGenerationSessionsForTests } from './generationSession';

afterEach(() => {
  clearGenerationSessionsForTests();
  vi.restoreAllMocks();
});

it('keeps the confirmed sources visible while waiting, streaming and stopping without writing', async () => {
  vi.spyOn(contextPackController, 'list').mockResolvedValue([]);
  const list = vi.spyOn(importController, 'listSources').mockResolvedValue([]);
  vi.spyOn(generationController, 'plan').mockResolvedValue({
    id: 'plan',
    requestId: 'request',
    targetTitle: '成果甲',
    prompt: '保留 420',
    manifest: { ...fixture, requiresSensitiveConfirmation: false } as ContextManifest,
  });
  vi.spyOn(generationController, 'confirm').mockResolvedValue(undefined);
  let emit!: (event: ChatStreamEvent) => void;
  let reject!: (error: Error) => void;
  vi.spyOn(generationController, 'start').mockImplementation((_id, handler) => {
    emit = handler;
    return new Promise<GenerationOutput>((_resolve, fail) => {
      reject = fail;
    });
  });
  const stop = vi.spyOn(generationController, 'stop').mockResolvedValue(true);
  const apply = vi.spyOn(generationController, 'apply');
  const onApplied = vi.fn();
  render(
    <I18nProvider>
      <GenerationPanel
        resultId="result-a"
        targetTitle="成果甲"
        workspaceId="target-workspace"
        onApplied={onApplied}
      />
    </I18nProvider>
  );
  expect(list).toHaveBeenCalledWith('target-workspace');
  fireEvent.change(screen.getByRole('textbox', { name: '写作要求' }), {
    target: { value: '保留 420' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认并生成' }));
  await waitFor(() => expect(generationController.start).toHaveBeenCalled());
  expect(screen.getByText('正在等待模型响应…')).toBeVisible();
  expect(screen.getByRole('textbox', { name: '写作要求' })).toHaveValue('');
  expect(screen.getByText('本次发送清单')).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: 'AI 写作' })).getByText(/meeting.md.*120/)
  ).toBeVisible();
  expect(screen.getByRole('textbox', { name: '写作要求' })).toHaveAttribute('readonly');
  expect(screen.getByRole('textbox', { name: '写作要求' })).not.toBeDisabled();
  act(() => emit({ type: 'delta', requestId: 'request', messageId: 'message', delta: '数字 420' }));
  await screen.findByText('正在生成…');
  expect(screen.getByText('数字 420')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '停止' }));
  expect(stop).toHaveBeenCalledWith('request');
  await act(async () => reject(new Error('已停止，未修改成果')));
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: '写作要求' })).not.toHaveAttribute('readonly')
  );
  expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '写作要求' }), {
    target: { value: '重新生成' },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  expect(apply).not.toHaveBeenCalled();
  expect(onApplied).not.toHaveBeenCalled();
});
