import type { CanvasBlock } from '../../shared/types/canvas';

const allowedTags = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'MARK',
  'SPAN',
  'P',
  'DIV',
  'BR',
  'UL',
  'OL',
  'LI',
  'H2',
  'H3',
  'BLOCKQUOTE',
  'FONT',
]);
const colorPattern = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;
const fontSizes: Record<string, string> = {
  '1': '11px',
  '2': '13px',
  '3': '15px',
  '4': '18px',
  '5': '24px',
  '6': '30px',
  '7': '36px',
};

export function sanitizeNoteHtml(html: string): string {
  const documentNode = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const source = documentNode.body.firstElementChild;
  const clean = document.createElement('div');
  const append = (node: ChildNode, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ''));
      return;
    }
    if (!(node instanceof Element)) return;
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG'].includes(node.tagName)) return;
    if (!allowedTags.has(node.tagName)) {
      node.childNodes.forEach((child) => append(child, parent));
      return;
    }
    const target = document.createElement(
      node.tagName === 'FONT' ? 'span' : node.tagName.toLowerCase()
    );
    const style = (node as HTMLElement).style;
    const fontColor = node.tagName === 'FONT' ? node.getAttribute('color') : null;
    const color = fontColor || style.color;
    if (color && colorPattern.test(color)) target.style.color = color;
    if (style.backgroundColor && colorPattern.test(style.backgroundColor))
      target.style.backgroundColor = style.backgroundColor;
    if (node.tagName === 'FONT') {
      const size = fontSizes[node.getAttribute('size') ?? ''];
      if (size) target.style.fontSize = size;
    } else if (/^(?:\d{1,2}(?:\.\d)?px|\d{1,3}%)$/.test(style.fontSize))
      target.style.fontSize = style.fontSize;
    if (['left', 'center', 'right', 'justify'].includes(style.textAlign))
      target.style.textAlign = style.textAlign;
    node.childNodes.forEach((child) => append(child, target));
    parent.appendChild(target);
  };
  source?.childNodes.forEach((node) => append(node, clean));
  return clean.innerHTML;
}

export function noteHtml(block: CanvasBlock): string {
  if (block.noteFormat === 'rich') return sanitizeNoteHtml(block.body);
  const wrapper = document.createElement('div');
  for (const part of block.body.split(/(==[\s\S]*?==)/g)) {
    if (part.startsWith('==') && part.endsWith('==')) {
      const mark = document.createElement('mark');
      mark.textContent = part.slice(2, -2);
      mark.style.backgroundColor = block.noteStyle?.highlightColor ?? '#fff0a6';
      wrapper.appendChild(mark);
    } else wrapper.appendChild(document.createTextNode(part));
  }
  return wrapper.innerHTML.replaceAll('\n', '<br>');
}
