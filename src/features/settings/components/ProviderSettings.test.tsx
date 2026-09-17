import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../app/i18n/I18nProvider';
import { useAppStore } from '../../../stores/useAppStore';
import { ProviderSettings } from './ProviderSettings';

vi.mock('../../../shared/platform/runtime', () => ({ getRuntimeMode: () => 'desktop' }));

describe('ProviderSettings local detection', () => {
  beforeEach(() => {
    useAppStore.setState({
      providerConfigs: [
        {
          id: 'custom',
          kind: 'custom',
          endpoint: 'http://localhost:7777/v1',
          model: 'local-model',
          temperature: 0.2,
          proxyUrl: null,
          configured: false,
          active: true,
        },
      ],
      activeProviderId: 'custom',
      providerLoading: false,
      providerError: null,
      localProviderProbes: [
        {
          id: 'custom',
          kind: 'custom',
          status: 'available',
          endpoint: 'http://localhost:7777/v1',
          models: ['local-model'],
          latencyMs: 10,
          failureCode: null,
        },
      ],
      localProbeLoading: false,
      localProbeError: null,
      probeLocalProviders: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('shows endpoint and model details in the professional-only dialog', async () => {
    const probe = useAppStore.getState().probeLocalProviders;
    render(
      <I18nProvider>
        <ProviderSettings open onClose={vi.fn()} includeSystemSettings={false} />
      </I18nProvider>
    );

    await waitFor(() => expect(probe).toHaveBeenCalledOnce());
    expect(screen.getAllByText('http://localhost:7777/v1').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/local-model/).length).toBeGreaterThan(0);
    expect(
      screen.getByText('仅检查固定 Ollama、LM Studio 端口和已保存的本机兼容端点，不扫描局域网。')
    ).toBeVisible();
  });
});
