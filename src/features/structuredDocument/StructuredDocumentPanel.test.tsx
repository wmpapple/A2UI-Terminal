import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/i18n/I18nProvider';
import type { DocumentSnapshot } from '../../shared/types/document';
import type { ReviewRequest } from '../../shared/types/domain';
import type { StructuredView } from '../../shared/types/structuredDocument';
import { StructuredDocumentPanel } from './StructuredDocumentPanel';
import { structuredController as api } from './structuredController';
import { editorMarkdown, inlineMarkdown } from './editorAdapter';

const snapshot: DocumentSnapshot = {
  target: { kind: 'result', resultId: 'r' },
  revisionId: 'v1',
  contentHash: 'h1',
  format: 'markdown',
  text: '原文',
  editable: true,
  hasUnsavedDraft: false,
};
const block = {
  id: 'block-1',
  source: '原文',
  node: {
    kind: 'paragraph' as const,
    runs: [{ text: '原文', bold: false, italic: false, code: false }],
  },
};
const view: StructuredView = {
  snapshot,
  document: { schemaVersion: 1, blocks: [block], trailing: '' },
  warnings: [],
};
const review = {
  id: 'review',
  workspaceId: 'workspace',
  status: 'pending',
  blocks: [{ id: 'b', before: '原文', after: '新段落' }],
} as ReviewRequest;
const tree = (s = snapshot, onApplied = vi.fn()) => (
  <I18nProvider>
    <StructuredDocumentPanel snapshot={s} onApplied={onApplied} />
  </I18nProvider>
);
describe('structured document editor', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(api, 'inspect').mockResolvedValue(view);
    vi.spyOn(api, 'propose').mockResolvedValue(review);
    vi.spyOn(api, 'discard').mockResolvedValue({ ...review, status: 'rejected' });
  });
  afterEach(() => vi.restoreAllMocks());
  const open = async () => {
    fireEvent.click(screen.getByRole('button', { name: '结构化编辑' }));
    await screen.findByText('原文');
  };
  it('only saves a structural edit after explicit review acceptance', async () => {
    const applied = vi.fn();
    const accept = vi.spyOn(api, 'accept').mockResolvedValue({
      reviewId: 'review',
      status: 'applied',
      files: [],
      result: null,
      operationId: null,
    });
    render(tree(snapshot, applied));
    await open();
    fireEvent.click(screen.getByRole('button', { name: '添加段落 / 列表' }));
    fireEvent.change(screen.getByRole('textbox', { name: '新段落内容' }), {
      target: { value: '新段落' },
    });
    fireEvent.click(screen.getByRole('button', { name: '预览插入' }));
    await waitFor(() => expect(api.propose).toHaveBeenCalled());
    const dialog = (await screen.findByText('确认文档修改')).closest(
      '[role="dialog"]'
    ) as HTMLElement;
    expect(api.propose).toHaveBeenCalledWith(snapshot, [
      { op: 'insert_block', afterId: 'block-1', markdown: '新段落' },
    ]);
    expect(accept).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '接受并保存' }));
    await waitFor(() => expect(applied).toHaveBeenCalledTimes(1));
  });
  it('discards the candidate without applying changes', async () => {
    const accept = vi.spyOn(api, 'accept');
    render(tree());
    await open();
    fireEvent.click(screen.getByRole('button', { name: '插入分页' }));
    const dialog = (await screen.findByText('确认文档修改')).closest(
      '[role="dialog"]'
    ) as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(api.discard).toHaveBeenCalledWith(review));
    expect(accept).not.toHaveBeenCalled();
  });
  it('does not reset typed text or formatting when its parent rerenders', async () => {
    render(tree());
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
    const editor = screen.getByRole('textbox', { name: '段落内容' });
    editor.innerHTML = '<p>新的内容 <strong>420</strong></p>';
    fireEvent.input(editor);
    expect(editor.textContent).toBe('新的内容 420');
    expect(editor.querySelector('strong')?.textContent).toBe('420');
    fireEvent.click(screen.getByRole('button', { name: '审阅本段修改' }));
    await waitFor(() =>
      expect(api.propose).toHaveBeenCalledWith(snapshot, [
        { op: 'replace_block', blockId: 'block-1', markdown: '新的内容 **420**' },
      ])
    );
  });
  it('invalidates a pending candidate when the destination changes', async () => {
    const accept = vi.spyOn(api, 'accept');
    const { rerender } = render(tree());
    await open();
    fireEvent.click(screen.getByRole('button', { name: '插入分页' }));
    await screen.findByText('确认文档修改');
    rerender(tree({ ...snapshot, contentHash: 'h2', hasUnsavedDraft: true }));
    await waitFor(() => expect(api.discard).toHaveBeenCalledWith(review));
    expect(screen.queryByRole('button', { name: '接受并保存' })).not.toBeInTheDocument();
    expect(accept).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '结构化编辑' })).toBeDisabled();
  });
  it('leaves PDF and imported source originals read-only', () => {
    render(tree({ ...snapshot, format: 'pdf', editable: false }));
    expect(screen.queryByRole('button', { name: '结构化编辑' })).not.toBeInTheDocument();
    expect(api.inspect).not.toHaveBeenCalled();
  });
  it('canceling the native import does not create a proposal', async () => {
    const importer = vi.spyOn(api, 'import').mockResolvedValue(null);
    render(tree());
    await open();
    fireEvent.click(screen.getByRole('button', { name: '导入 Word / Markdown' }));
    await waitFor(() => expect(importer).toHaveBeenCalledWith(snapshot));
    expect(screen.queryByRole('dialog', { name: '确认文档修改' })).not.toBeInTheDocument();
  });
});

describe('replaceable editor adapter', () => {
  it('converts supported marks without persisting HTML or executable content', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p><strong>预算</strong> <em>420</em> 元<script>bad()</script><img src="https://example.test/x"/></p>';
    expect(editorMarkdown(root, block)).toBe('**预算** *420* 元');
    root.innerHTML = '<strong><p>预算 420 元，尚未批准。</p></strong>';
    expect(editorMarkdown(root, block)).toBe('**预算 420 元，尚未批准。**');
    root.innerHTML = '<p>**不是格式** &lt;script&gt;</p>';
    expect(inlineMarkdown(root)).toContain('\\*\\*不是格式\\*\\*');
  });
});
