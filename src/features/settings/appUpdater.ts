import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { getRuntimeMode } from '../../shared/platform/runtime';

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'installed'
  | 'unavailable'
  | 'error';

export interface UpdateSnapshot {
  phase: UpdatePhase;
  currentVersion: string;
  nextVersion?: string;
  notes?: string;
  progress?: number;
  error?: string;
}

const listeners = new Set<() => void>();
let pendingUpdate: Update | null = null;
let snapshot: UpdateSnapshot = {
  phase: getRuntimeMode() === 'desktop' ? 'idle' : 'unavailable',
  currentVersion: '',
};

const publish = (next: UpdateSnapshot) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

const publicError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:[A-Za-z]:\\|\/)[^\s"']+/g, '[local-path]').slice(0, 240);
};

export const getUpdateSnapshot = () => snapshot;

export const subscribeToUpdates = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export async function checkForAppUpdate(): Promise<UpdateSnapshot> {
  if (getRuntimeMode() !== 'desktop') return snapshot;

  const currentVersion = snapshot.currentVersion || (await getVersion());
  publish({ phase: 'checking', currentVersion });
  try {
    const update = await check({ timeout: 15_000 });
    pendingUpdate = update;
    if (!update) {
      publish({ phase: 'current', currentVersion });
    } else {
      publish({
        phase: 'available',
        currentVersion,
        nextVersion: update.version,
        notes: update.body ?? undefined,
      });
    }
  } catch (error) {
    pendingUpdate = null;
    const message = publicError(error);
    publish({
      phase: /endpoint|pubkey|public key|configuration/i.test(message) ? 'unavailable' : 'error',
      currentVersion,
      error: message,
    });
  }
  return snapshot;
}

export async function installPendingUpdate(): Promise<void> {
  if (getRuntimeMode() !== 'desktop') return;
  if (!pendingUpdate) {
    await checkForAppUpdate();
  }
  const update = pendingUpdate;
  if (!update) return;

  let downloaded = 0;
  let total = 0;
  publish({ ...snapshot, phase: 'downloading', progress: 0, error: undefined });
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? 0;
      if (event.event === 'Progress') downloaded += event.data.chunkLength;
      if (event.event === 'Progress' || event.event === 'Started') {
        publish({
          ...snapshot,
          phase: 'downloading',
          progress: total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined,
        });
      }
    });
    publish({ ...snapshot, phase: 'installed', progress: 100 });
    await relaunch();
  } catch (error) {
    publish({ ...snapshot, phase: 'error', error: publicError(error) });
  }
}

export function scheduleAutomaticUpdateCheck(delayMs = 3_000): () => void {
  if (getRuntimeMode() !== 'desktop') return () => undefined;
  const timer = window.setTimeout(() => void checkForAppUpdate(), delayMs);
  return () => window.clearTimeout(timer);
}
