type ClearableStorage = Pick<Storage, 'clear'>;

/**
 * Clears UI-only data owned by this application after the trusted Rust clear
 * transaction succeeds. Business records and credentials are cleared by Rust.
 */
export function clearWebviewLocalData(
  persistentStorage: ClearableStorage = localStorage,
  sessionOnlyStorage: ClearableStorage = sessionStorage
): void {
  try {
    persistentStorage.clear();
  } catch {
    // Storage may be unavailable in a hardened WebView. Continue with the
    // session store so the clear flow remains best-effort on the UI side.
  }

  try {
    sessionOnlyStorage.clear();
  } catch {
    // The trusted Rust transaction has already completed at this point.
  }
}

export function scheduleApplicationReload(delayMs = 250): void {
  window.setTimeout(() => window.location.reload(), delayMs);
}
