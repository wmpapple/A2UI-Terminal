import type { DocumentBlock } from '../../shared/types/structuredDocument';

const escape = (value: string) => value.replace(/[\\`*_{}[\]<>#!|]/g, '\\$&');
/** Only text and explicitly supported marks cross the DOM/AST boundary. */
export function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? '');
  if (!(node instanceof HTMLElement)) return '';
  if (['SCRIPT', 'STYLE', 'IFRAME', 'IMG'].includes(node.tagName)) return '';
  if (node.tagName === 'BR') return '\n';
  const content = Array.from(node.childNodes).map(inlineMarkdown).join('');
  if (['STRONG', 'B', 'EM', 'I'].includes(node.tagName)) {
    const mark = ['STRONG', 'B'].includes(node.tagName) ? '**' : '*';
    const text = content.trim();
    if (!text) return content;
    return (
      content.slice(0, content.length - content.trimStart().length) +
      mark +
      text +
      mark +
      content.slice(content.trimEnd().length)
    );
  }
  if (['P', 'DIV'].includes(node.tagName)) return content + '\n';
  return content;
}

export function editorMarkdown(root: HTMLElement, block: DocumentBlock): string {
  const text = Array.from(root.childNodes).map(inlineMarkdown).join('').trim();
  if (block.node.kind === 'heading') return '#'.repeat(block.node.level) + ' ' + text;
  if (block.node.kind === 'quote')
    return text
      .split('\n')
      .map((line) => '> ' + line)
      .join('\n');
  return text;
}

export function markSelection(root: HTMLElement, mark: 'strong' | 'em'): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return false;
  const element = document.createElement(mark);
  element.append(range.extractContents());
  range.insertNode(element);
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
