import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../../shared/types/domain';
import { useAppStore } from '../../stores/useAppStore';
import { providerController } from './providerController';

vi.mock('./providerController', () => ({
  providerController: {
    list: vi.fn(),
    save: vi.fn(),
    select: vi.fn(),
    deleteKey: vi.fn(),
    test: vi.fn(),
  },
}));

const cloudProvider: ProviderConfig = {
  id: 'deepseek',
  kind: 'open_ai',
  endpoint: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-flash',
  temperature: 0.2,
  proxyUrl: null,
  configured: true,
  active: true,
};

const localProvider: ProviderConfig = {
  ...cloudProvider,
  endpoint: 'http://localhost:11434/v1',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    runtimeMode: 'desktop',
    providerConfigs: [cloudProvider],
    activeProviderId: cloudProvider.id,
    providerLoading: false,
    providerError: null,
    sessions: [
      {
        id: 'existing-session',
        title: 'Existing session',
        messages: [
          { id: 'message', role: 'user', content: 'Previous request', status: 'complete' },
        ],
      },
      { id: 'empty-session', title: 'Empty session', messages: [] },
    ],
    contextReviewKeyBySession: {},
  });
});

describe('provider context review invalidation', () => {
  it('invalidates pre-existing conversations when the active Provider configuration changes', async () => {
    vi.mocked(providerController.save).mockResolvedValue(localProvider);
    vi.mocked(providerController.list).mockResolvedValue([localProvider]);

    await useAppStore.getState().saveProvider(localProvider);

    expect(useAppStore.getState().contextReviewKeyBySession).toEqual({
      'existing-session': 'provider-configuration-changed',
    });
  });

  it('invalidates an unbaselined historical conversation when the active Provider is saved again', async () => {
    vi.mocked(providerController.save).mockResolvedValue(cloudProvider);
    vi.mocked(providerController.list).mockResolvedValue([cloudProvider]);

    await useAppStore.getState().saveProvider(cloudProvider);

    expect(useAppStore.getState().contextReviewKeyBySession).toEqual({
      'existing-session': 'provider-configuration-changed',
    });
  });

  it('invalidates pre-existing conversations when another Provider becomes active', async () => {
    const loopbackProvider: ProviderConfig = {
      ...localProvider,
      id: 'loopback',
      model: 'local-model',
      active: false,
    };
    useAppStore.setState({ providerConfigs: [cloudProvider, loopbackProvider] });
    vi.mocked(providerController.select).mockResolvedValue(undefined);

    await useAppStore.getState().selectProvider(loopbackProvider.id);

    expect(useAppStore.getState().activeProviderId).toBe(loopbackProvider.id);
    expect(useAppStore.getState().contextReviewKeyBySession).toEqual({
      'existing-session': 'provider-configuration-changed',
    });
  });

  it('keeps reviews when saving the active Provider without changing request settings', async () => {
    useAppStore.setState({ contextReviewKeyBySession: { 'existing-session': 'reviewed' } });
    vi.mocked(providerController.save).mockResolvedValue(cloudProvider);
    vi.mocked(providerController.list).mockResolvedValue([cloudProvider]);

    await useAppStore.getState().saveProvider(cloudProvider, 'replacement-secret');

    expect(useAppStore.getState().contextReviewKeyBySession).toEqual({
      'existing-session': 'reviewed',
    });
  });
});
