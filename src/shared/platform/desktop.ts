import { invoke } from '@tauri-apps/api/core';
import { getRuntimeMode } from './runtime';

export interface BootstrapStatus {
  runtime: 'desktop';
  databaseReady: boolean;
  schemaVersion: number;
  credentialStore: 'windows-credential-manager';
}

export interface SecretStatus {
  providerId: string;
  configured: boolean;
}

const requireDesktop = (): void => {
  if (getRuntimeMode() !== 'desktop') {
    throw new Error('Desktop API is unavailable in Web Mock mode.');
  }
};

export const desktopApi = {
  async getBootstrapStatus(): Promise<BootstrapStatus> {
    requireDesktop();
    return invoke<BootstrapStatus>('get_bootstrap_status');
  },

  async setProviderSecret(providerId: string, secret: string): Promise<SecretStatus> {
    requireDesktop();
    return invoke<SecretStatus>('set_provider_secret', { providerId, secret });
  },

  async getProviderSecretStatus(providerId: string): Promise<SecretStatus> {
    requireDesktop();
    return invoke<SecretStatus>('provider_secret_status', { providerId });
  },

  async deleteProviderSecret(providerId: string): Promise<SecretStatus> {
    requireDesktop();
    return invoke<SecretStatus>('delete_provider_secret', { providerId });
  },

  async clearAllLocalData(confirmation: string): Promise<{ cleared: boolean }> {
    requireDesktop();
    return invoke<{ cleared: boolean }>('clear_all_local_data', { confirmation });
  },
};
