const ONBOARDING_STORAGE_KEY = 'a2ui.onboarding-complete.v1';

export function readOnboardingComplete(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeOnboardingComplete(storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, 'true');
  } catch {
    // Onboarding remains usable when optional UI preference storage is unavailable.
  }
}
