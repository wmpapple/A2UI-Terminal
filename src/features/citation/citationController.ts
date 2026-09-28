import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';
import type { CitationView, UpgradeProgress } from '../../shared/types/citation';

export const citationController = {
  async list(
    ownerKind: 'result' | 'message',
    ownerId: string,
    content: string
  ): Promise<CitationView[]> {
    if (!isWebMock()) return desktopGateway.listCitations({ ownerKind, ownerId });
    // Web Mock has no persisted source authorization; never invent verification.
    return [...new Set(content.match(/\[S\d+\]/g) ?? [])].map((key) => ({
      key: key.slice(1, -1),
      title: '',
      locator: null,
      status: 'unknown',
      excerpt: null,
    }));
  },
  async upgrade(process: boolean, retryFailed = false): Promise<UpgradeProgress> {
    if (!isWebMock()) return desktopGateway.upgradeKnowledgeLocators(process, retryFailed);
    return { pending: 0, completed: 0, failed: 0, errors: [] };
  },
};
