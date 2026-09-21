import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fixture from '../../../contracts/v2x/document.json';
import type { DocumentSnapshot, SelectionSnapshot } from '../../shared/types/document';
import {
  isDocumentSnapshot,
  isDocumentTarget,
  isParsedDocument,
  isSelectionSnapshot,
} from '../../shared/contracts/document';
import { createEditorAdapter, textHash, validRange } from './editorAdapter';

beforeAll(async () => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto');
  vi.stubGlobal('crypto', webcrypto);
});
afterAll(() => vi.unstubAllGlobals());

function harness() {
  let snapshot: DocumentSnapshot = structuredClone(fixture.snapshot) as DocumentSnapshot;
  let selected = { text: snapshot.text, start: 2, end: 4 };
  const showProposal = vi.fn();
  const receive = vi.fn();
  return {
    adapter: createEditorAdapter({
      snapshot: () => snapshot,
      source: { read: () => selected },
      showProposal,
      receiveAuthoritativeSnapshot: receive,
    }),
    showProposal,
    receive,
    setSnapshot: (next: DocumentSnapshot) => {
      snapshot = next;
    },
    setSelection: (next: typeof selected) => {
      selected = next;
    },
  };
}

describe('F0 shared document contract and editor adapter', () => {
  it('matches the Rust fixture including UTF-16 emoji and exact CRLF hashes', async () => {
    expect(isDocumentSnapshot(fixture.snapshot)).toBe(true);
    expect(isSelectionSnapshot(fixture.selection)).toBe(true);
    expect(isParsedDocument(fixture.parsed)).toBe(true);
    expect(isDocumentTarget(fixture.resultTarget)).toBe(true);
    expect(await textHash(fixture.snapshot.text)).toBe(fixture.snapshot.contentHash);
    expect(await harness().adapter.readSelection()).toEqual(fixture.selection);
  });

  it('rejects paths, unknown write fields, unsafe offsets and unsupported units', () => {
    expect(isDocumentTarget({ ...fixture.resultTarget, path: 'C:/private.txt' })).toBe(false);
    expect(isDocumentTarget({ ...fixture.resultTarget, resultId: '../../private.txt' })).toBe(
      false
    );
    expect(isSelectionSnapshot({ ...fixture.selection, replacement: 'injected' })).toBe(false);
    expect(isSelectionSnapshot({ ...fixture.selection, offsetUnit: 'bytes' })).toBe(false);
    for (const start of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      expect(isSelectionSnapshot({ ...fixture.selection, start })).toBe(false);
    for (const [start, end] of [
      [2, 3],
      [3, 4],
      [0, 100],
      [4, 4],
      [5, 1],
    ])
      expect(validRange({ text: fixture.snapshot.text, start, end })).toBe(false);
    expect(validRange({ text: fixture.snapshot.text, start: 4, end: 8 })).toBe(true);
  });

  it('rejects unsaved text, read-only documents and asynchronous document switches', async () => {
    const h = harness();
    h.setSelection({ text: fixture.snapshot.text + 'unsaved', start: 2, end: 4 });
    expect(await h.adapter.readSelection()).toBeNull();
    h.setSelection({ text: fixture.snapshot.text, start: 2, end: 4 });
    h.setSnapshot({
      ...fixture.snapshot,
      target: fixture.snapshot.target as DocumentSnapshot['target'],
      editable: false,
    });
    expect(await h.adapter.readSelection()).toBeNull();
    h.setSnapshot(fixture.snapshot as DocumentSnapshot);
    const pending = h.adapter.readSelection();
    h.setSnapshot({
      ...fixture.snapshot,
      target: fixture.resultTarget as DocumentSnapshot['target'],
    });
    expect(await pending).toBeNull();
  });

  it('shows a proposal without applying it and clears stale proposals', async () => {
    const h = harness();
    const proposal = { selection: fixture.selection as SelectionSnapshot, replacement: 'new' };
    expect(await h.adapter.showProposal(proposal)).toBe(true);
    expect(h.showProposal).toHaveBeenCalledWith(proposal);
    expect(h.receive).not.toHaveBeenCalled();
    h.setSelection({ text: fixture.snapshot.text, start: 0, end: 2 });
    expect(await h.adapter.showProposal(proposal)).toBe(false);
    expect(h.showProposal).toHaveBeenLastCalledWith(null);
  });

  it('only receives matching authoritative snapshots with verified content hashes', async () => {
    const h = harness();
    const next = {
      ...fixture.snapshot,
      target: fixture.snapshot.target as DocumentSnapshot['target'],
      text: 'new',
      contentHash: await textHash('new'),
    };
    expect(
      await h.adapter.receiveAuthoritativeSnapshot(fixture.selection as SelectionSnapshot, {
        ...next,
        contentHash: '0'.repeat(64),
      })
    ).toBe(false);
    expect(
      await h.adapter.receiveAuthoritativeSnapshot(fixture.selection as SelectionSnapshot, next)
    ).toBe(true);
    expect(h.receive).toHaveBeenCalledExactlyOnceWith(next);
    expect(h.showProposal).toHaveBeenLastCalledWith(null);
  });
});
