import type { AppGet, AppSet, AppState } from '../../stores/types';
import { errorDetails } from '../../stores/support';
import { providerController } from './providerController';

type ProviderActions = Pick<
  AppState,
  'initializeProviders' | 'saveProvider' | 'selectProvider' | 'deleteProviderKey' | 'testProvider'
>;

const providerReviewFingerprint = (config: AppState['providerConfigs'][number] | undefined) =>
  config
    ? JSON.stringify([
        config.id,
        config.endpoint,
        config.model,
        config.proxyUrl,
        config.temperature,
      ])
    : '';

export const createProviderStore = (set: AppSet, get: AppGet): ProviderActions => ({
  initializeProviders: async () => {
    if (get().runtimeMode === 'web-mock') return;
    set({ providerLoading: true, providerError: null });
    try {
      const providerConfigs = await providerController.list();
      set({
        providerConfigs,
        activeProviderId: providerConfigs.find((config) => config.active)?.id ?? 'siliconflow',
      });
    } catch (error) {
      set({ providerError: errorDetails(error).message });
    } finally {
      set({ providerLoading: false });
    }
  },
  saveProvider: async (config, secret) => {
    if (get().runtimeMode === 'web-mock') return;
    const stateBeforeSave = get();
    const previousConfig = stateBeforeSave.providerConfigs.find((item) => item.id === config.id);
    const hasUnbaselinedSentSession = stateBeforeSave.sessions.some(
      (session) =>
        session.messages.some((chatMessage) => chatMessage.role === 'user') &&
        !stateBeforeSave.contextReviewKeyBySession[session.id]
    );
    const invalidatesActiveProviderReview =
      config.id === stateBeforeSave.activeProviderId &&
      (providerReviewFingerprint(previousConfig) !== providerReviewFingerprint(config) ||
        hasUnbaselinedSentSession);
    set({ providerLoading: true, providerError: null });
    try {
      await providerController.save(config, secret?.trim() || undefined);
      await get().initializeProviders();
      if (invalidatesActiveProviderReview) get().invalidateContextReviewsForProviderChange();
    } catch (error) {
      const details = errorDetails(error);
      set({ providerError: details.message });
      throw new Error(details.message);
    } finally {
      set({ providerLoading: false });
    }
  },
  selectProvider: async (providerId) => {
    if (get().runtimeMode === 'web-mock') return;
    const invalidatesProviderReview = providerId !== get().activeProviderId;
    try {
      await providerController.select(providerId);
      set((state) => ({
        activeProviderId: providerId,
        providerConfigs: state.providerConfigs.map((config) => ({
          ...config,
          active: config.id === providerId,
        })),
      }));
      if (invalidatesProviderReview) get().invalidateContextReviewsForProviderChange();
    } catch (error) {
      set({ providerError: errorDetails(error).message });
    }
  },
  deleteProviderKey: async (providerId) => {
    if (get().runtimeMode === 'web-mock') return;
    set({ providerLoading: true, providerError: null });
    try {
      await providerController.deleteKey(providerId);
      await get().initializeProviders();
    } catch (error) {
      set({ providerError: errorDetails(error).message });
    } finally {
      set({ providerLoading: false });
    }
  },
  testProvider: async (providerId) => {
    if (get().runtimeMode === 'web-mock') return 0;
    set({ providerLoading: true, providerError: null });
    try {
      return (await providerController.test(providerId)).latencyMs;
    } catch (error) {
      const message = errorDetails(error).message;
      set({ providerError: message });
      throw new Error(message);
    } finally {
      set({ providerLoading: false });
    }
  },
});
