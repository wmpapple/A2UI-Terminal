/** Mark selected text per line, leaving Markdown block prefixes and whitespace intact. */
export function formatSelection(content: string, start: number, end: number, mark: '**' | '*') {
  if (start < 0 || end <= start || end > content.length) return null;
  let offset = start;
  const selected = content.slice(start, end).split(/(\r?\n)/);
  const replacement = selected
    .map((part) => {
      const atLineStart = offset === 0 || content[offset - 1] === '\n';
      offset += part.length;
      if (!part.trim()) return part;
      const prefix = atLineStart
        ? (part.match(
            /^(?:[ \t]*(?:>[ \t]*|#{1,6}[ \t]+|(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))+/
          )?.[0] ?? '')
        : '';
      const body = part.slice(prefix.length);
      const text = body.trim();
      if (!text) return part;
      const leading = body.slice(0, body.length - body.trimStart().length);
      const trailing = body.slice(body.trimEnd().length);
      const wrapped = text.startsWith(mark) && text.endsWith(mark) && text.length > mark.length * 2;
      const formatted = wrapped ? text.slice(mark.length, -mark.length) : `${mark}${text}${mark}`;
      return prefix + leading + formatted + trailing;
    })
    .join('');
  return {
    content: content.slice(0, start) + replacement + content.slice(end),
    start,
    end: start + replacement.length,
  };
}
