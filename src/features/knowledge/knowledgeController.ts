import { desktopGateway } from '../../shared/platform/gateway';
import { isWebMock } from '../../shared/platform/runtime';
import type {
  EditKnowledgeInput,
  KnowledgeDocument,
  ListKnowledgeInput,
} from '../../shared/types/knowledge';

const key = 'a2ui.web-mock.knowledge.v1';
const read = (): KnowledgeDocument[] => JSON.parse(localStorage.getItem(key) ?? '[]');
const write = (items: KnowledgeDocument[]) => localStorage.setItem(key, JSON.stringify(items));

export const knowledgeController = {
  async list(input: ListKnowledgeInput = {}) {
    if (!isWebMock()) return desktopGateway.listPersonalKnowledge(input);
    const query = input.query?.trim().toLowerCase() ?? '';
    const records = read().filter((d) => !query || JSON.stringify(d).toLowerCase().includes(query));
    const offset = input.after ?? 0;
    const limit = input.limit ?? 40;
    return {
      items: records.slice(offset, offset + limit).map((d) => d.source),
      nextCursor: records.length > offset + limit ? offset + limit : null,
    };
  },
  async get(id: string) {
    if (!isWebMock()) return desktopGateway.getPersonalKnowledge(id);
    const d = read().find((d) => d.source.id === id);
    if (!d) throw new Error('Source unavailable');
    return d;
  },
  async edit(input: EditKnowledgeInput) {
    if (!isWebMock()) return desktopGateway.editPersonalKnowledge(input);
    const records = read();
    const d = records.find((d) => d.source.id === input.id);
    if (!d || !input.title.trim()) throw new Error('Invalid source or title');
    d.source = {
      ...d.source,
      title: input.title.trim(),
      tags: input.tags,
      updatedAt: new Date().toISOString(),
    };
    write(records);
    return d.source;
  },
  async delete(id: string) {
    if (!isWebMock()) return desktopGateway.deletePersonalKnowledge(id);
    write(read().filter((d) => d.source.id !== id));
  },
  async confirm(batchId: string, acceptedItemIds: string[], confirmed: boolean) {
    return desktopGateway.confirmPersonalKnowledgeImport(batchId, acceptedItemIds, confirmed);
  },
  // Browser-only fixture path; Office/PDF parsing remains a desktop responsibility.
  async importMock(files: File[]) {
    if (!isWebMock()) throw new Error('Browser import is unavailable on desktop');
    if (files.length > 20) throw new Error('Maximum 20 files');
    const records = read();
    const additions: KnowledgeDocument[] = [];
    for (const file of files) {
      const format = file.name.split('.').at(-1)?.toLowerCase() ?? '';
      if (!['txt', 'md'].includes(format) || file.size > 2 * 1024 * 1024)
        throw new Error('Web Mock: use TXT/MD up to 2 MB');
      const bytes = await file.arrayBuffer();
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
      if ([...records, ...additions].some((d) => d.source.rawHash === hash)) continue;
      const now = new Date().toISOString();
      additions.push({
        source: {
          id: crypto.randomUUID(),
          title: file.name,
          format,
          originalName: file.name,
          rawHash: hash,
          extractedHash: hash,
          parserVersion: 'web-mock',
          sourceVersion: 1,
          tags: [],
          status: 'ready',
          createdAt: now,
          updatedAt: now,
        },
        parsed: {
          blocks: [{ id: 'block-1', text, locator: { kind: 'unavailable' } }],
          warnings: [],
        },
      });
    }
    write([...records, ...additions]);
  },
};
