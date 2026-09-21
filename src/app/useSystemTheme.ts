import { useCallback, useSyncExternalStore } from 'react';

function useMediaPreference(query: string) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

export function useSystemTheme() {
  return useMediaPreference('(prefers-color-scheme: dark)');
}

export function useReducedMotion() {
  return useMediaPreference('(prefers-reduced-motion: reduce)');
}
