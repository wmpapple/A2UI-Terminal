import { afterEach, expect, it, vi } from 'vitest';
import { desktopGateway } from '../../shared/platform/gateway';
import { collaborationController as api } from './collaborationController';
import fixture from '../../../contracts/v2/collaboration.json';
import type { CollaborationPackage } from '../../shared/types/collaboration';
afterEach(() => vi.restoreAllMocks());
it('uses the shared offline package contract and never passes paths to import/export', async () => {
  const packages = fixture as { share: CollaborationPackage; feedback: CollaborationPackage };
  expect(packages.share.kind).toBe('share');
  expect(packages.feedback.kind).toBe('feedback');
  const importer = vi.spyOn(desktopGateway, 'collaborationImport').mockResolvedValue('id');
  const exporter = vi.spyOn(desktopGateway, 'collaborationExport').mockResolvedValue(true);
  await api.import();
  await api.export('id', true);
  expect(importer).toHaveBeenCalledWith();
  expect(exporter).toHaveBeenCalledWith('id', true);
});
