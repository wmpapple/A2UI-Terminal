export type ExperienceMode = 'simple' | 'professional';
export type AppRoute = 'home' | 'results' | 'templates' | 'workbench' | 'settings';

const MODE_STORAGE_KEY = 'a2ui.experience-mode.v1';
const ROUTES = new Set<AppRoute>(['home', 'results', 'templates', 'workbench', 'settings']);

export function readExperienceMode(
  storage: Pick<Storage, 'getItem'> = localStorage
): ExperienceMode {
  try {
    return storage.getItem(MODE_STORAGE_KEY) === 'professional' ? 'professional' : 'simple';
  } catch {
    return 'simple';
  }
}

export function writeExperienceMode(
  mode: ExperienceMode,
  storage: Pick<Storage, 'setItem'> = localStorage
): void {
  try {
    storage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Storage is a convenience only. The in-memory mode switch must remain usable.
  }
}

export function routeFromHash(hash: string): AppRoute {
  const route = hash.replace(/^#\/?/, '').split(/[/?]/, 1)[0] as AppRoute;
  return ROUTES.has(route) ? route : 'home';
}

export function navigateTo(route: AppRoute): void {
  const nextHash = `#/${route}`;
  if (window.location.hash === nextHash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = nextHash;
  }
}
