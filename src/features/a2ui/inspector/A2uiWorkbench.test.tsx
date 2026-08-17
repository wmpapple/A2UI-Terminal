import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { createMockA2ui } from '../../../shared/mock/workspace';
import { useAppStore } from '../../../stores/useAppStore';
import { A2uiWorkbench } from './A2uiWorkbench';

beforeEach(() => {
  const mock = createMockA2ui();
  useAppStore.setState({
    a2uiSurfaces: [mock.surface],
    a2uiInspections: [mock.inspection],
    activeSurfaceId: mock.surface.surfaceId,
    activeInspectionId: mock.inspection.id,
    a2uiActionLoading: false,
    a2uiNotice: null,
    centerView: 'surface',
    runtimeMode: 'web-mock',
  });
});

describe('A2uiWorkbench', () => {
  it('shows the validated runtime and Inspector together', () => {
    render(
      <I18nProvider>
        <A2uiWorkbench />
      </I18nProvider>
    );
    expect(screen.getByText('Research profile')).toBeInTheDocument();
    expect(screen.getByText('协议 Inspector')).toBeInTheDocument();
    expect(screen.getByText('Schema')).toBeInTheDocument();
  });

  it('keeps invalid raw messages inspectable but does not render them', () => {
    useAppStore.setState({
      a2uiSurfaces: [],
      a2uiInspections: [
        {
          id: 'invalid',
          messageId: 'message',
          surfaceId: 'unsafe',
          rawMessage: '{"component":"Script"}',
          validation: {
            valid: false,
            errors: ['未注册组件：Script'],
            warnings: [],
            durationMs: 1,
          },
          createdAt: null,
        },
      ],
      activeSurfaceId: '',
      activeInspectionId: 'invalid',
    });
    render(
      <I18nProvider>
        <A2uiWorkbench />
      </I18nProvider>
    );
    expect(screen.getByText('Surface 已被安全拒绝，不会渲染')).toBeInTheDocument();
    expect(screen.queryByLabelText(/A2UI Surface/)).not.toBeInTheDocument();
  });

  it('keeps the validated runtime but hides protocol Inspector details in simple mode', () => {
    render(
      <I18nProvider>
        <A2uiWorkbench showInspector={false} />
      </I18nProvider>
    );

    expect(screen.getByText('Research profile')).toBeInTheDocument();
    expect(screen.queryByText('协议 Inspector')).not.toBeInTheDocument();
    expect(screen.queryByText('Schema')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('协议消息')).not.toBeInTheDocument();
  });

  it('closes the current interaction result without deleting its history', () => {
    render(
      <I18nProvider>
        <A2uiWorkbench showInspector={false} />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    expect(useAppStore.getState().centerView).toBe('editor');
    expect(useAppStore.getState().a2uiSurfaces).toHaveLength(1);
  });

  it('requires confirmation before permanently deleting the current interaction result', async () => {
    render(
      <I18nProvider>
        <A2uiWorkbench />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /永久删除/ }));
    expect(screen.getByText('永久删除当前交互成果？')).toBeInTheDocument();
    expect(screen.getByText(/此操作不可撤销/)).toBeInTheDocument();
    expect(screen.getByLabelText('Surface')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /取.*消/ }));
    expect(useAppStore.getState().a2uiSurfaces).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /永久删除/ }));
    const deleteButtons = screen.getAllByRole('button', { name: /永久删除/ });
    fireEvent.click(deleteButtons.at(-1)!);

    await waitFor(() => expect(useAppStore.getState().a2uiSurfaces).toHaveLength(0));
    expect(useAppStore.getState().a2uiInspections).toHaveLength(0);
    expect(useAppStore.getState().centerView).toBe('editor');
  });
});
