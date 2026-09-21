import type {
  DocumentSnapshot,
  DocumentTarget,
  SelectionSnapshot,
} from '../../shared/types/document';

/** Source positions only. Preview DOM text must never implement this port. */
export interface SourceSelection {
  text: string;
  start: number;
  end: number;
}

export interface SourceEditorPort {
  read: () => SourceSelection | null;
}

export interface InlineProposal {
  selection: SelectionSnapshot;
  replacement: string;
}

export const sameTarget = (a: DocumentTarget, b: DocumentTarget): boolean =>
  a.kind === 'result'
    ? b.kind === 'result' && a.resultId === b.resultId
    : b.kind === 'workspace_file' && a.workspaceId === b.workspaceId && a.sourceId === b.sourceId;

export const textHash = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const boundary = (text: string, at: number) =>
  !(
    at > 0 &&
    at < text.length &&
    /[\uD800-\uDBFF]/u.test(text[at - 1]) &&
    /[\uDC00-\uDFFF]/u.test(text[at])
  );

export const validRange = ({ text, start, end }: SourceSelection) =>
  Number.isSafeInteger(start) &&
  Number.isSafeInteger(end) &&
  start >= 0 &&
  end > start &&
  end <= text.length &&
  boundary(text, start) &&
  boundary(text, end);

export const codeMirrorSelection = (
  view:
    | {
        state: {
          doc: { toString(): string };
          selection: { ranges: readonly unknown[]; main: { from: number; to: number } };
        };
      }
    | undefined
): SourceSelection | null => {
  if (!view || view.state.selection.ranges.length !== 1) return null;
  const { from: start, to: end } = view.state.selection.main;
  const result = { text: view.state.doc.toString(), start, end };
  return validRange(result) ? result : null;
};

export const textAreaSelection = (
  element: HTMLTextAreaElement | null | undefined
): SourceSelection | null => {
  if (!element || element.disabled || element.readOnly) return null;
  const result = { text: element.value, start: element.selectionStart, end: element.selectionEnd };
  return validRange(result) ? result : null;
};

/** UI rendering is replaceable. This adapter never applies a model proposal or
 * writes through IPC; the caller supplies the existing Review/apply/reload flow. */
export function createEditorAdapter(options: {
  snapshot: () => DocumentSnapshot | null;
  source: SourceEditorPort;
  showProposal: (proposal: InlineProposal | null) => void;
  receiveAuthoritativeSnapshot: (snapshot: DocumentSnapshot) => void;
}) {
  const capture = async (): Promise<SelectionSnapshot | null> => {
    const base = options.snapshot();
    const selected = options.source.read();
    if (
      !base ||
      !base.editable ||
      base.hasUnsavedDraft ||
      !selected ||
      !validRange(selected) ||
      base.text !== selected.text
    )
      return null;
    const baseKey = JSON.stringify(base);
    const [contentHash, selectedTextHash] = await Promise.all([
      textHash(selected.text),
      textHash(selected.text.slice(selected.start, selected.end)),
    ]);
    // Hashing is asynchronous: switching documents, typing or moving the range
    // while it runs invalidates the capture, even if the old hash was correct.
    const after = options.source.read();
    if (
      contentHash !== base.contentHash ||
      JSON.stringify(options.snapshot()) !== baseKey ||
      !after ||
      after.text !== selected.text ||
      after.start !== selected.start ||
      after.end !== selected.end
    )
      return null;
    return {
      target: base.target,
      revisionId: base.revisionId,
      contentHash,
      start: selected.start,
      end: selected.end,
      offsetUnit: 'utf16',
      selectedTextHash,
    };
  };
  const matches = (a: SelectionSnapshot, b: SelectionSnapshot) =>
    sameTarget(a.target, b.target) &&
    a.revisionId === b.revisionId &&
    a.contentHash === b.contentHash &&
    a.start === b.start &&
    a.end === b.end &&
    a.offsetUnit === b.offsetUnit &&
    a.selectedTextHash === b.selectedTextHash;
  return {
    readSnapshot: options.snapshot,
    readSelection: capture,
    async showProposal(proposal: InlineProposal) {
      const selection = await capture();
      if (!selection || !matches(selection, proposal.selection)) {
        options.showProposal(null);
        return false;
      }
      options.showProposal(proposal);
      return true;
    },
    clearProposal: () => options.showProposal(null),
    async receiveAuthoritativeSnapshot(expected: SelectionSnapshot, next: DocumentSnapshot) {
      const current = await capture();
      if (
        !current ||
        !matches(current, expected) ||
        !sameTarget(expected.target, next.target) ||
        next.hasUnsavedDraft ||
        (await textHash(next.text)) !== next.contentHash
      )
        return false;
      // Revalidate after the second asynchronous digest as well.
      const stillCurrent = await capture();
      if (!stillCurrent || !matches(stillCurrent, expected)) return false;
      options.receiveAuthoritativeSnapshot(next);
      options.showProposal(null);
      return true;
    },
  };
}
