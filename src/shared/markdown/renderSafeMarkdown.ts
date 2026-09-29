import MarkdownIt from 'markdown-it';

const markdownRenderer = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

markdownRenderer.block.ruler.before(
  'html_block',
  'document_page_break',
  (state, start, _end, silent) => {
    const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    if (line.trim() !== '<!-- pagebreak -->' || state.sCount[start] >= 4) return false;
    if (!silent) {
      state.push('document_page_break', 'hr', 0);
      state.line = start + 1;
    }
    return true;
  }
);
markdownRenderer.renderer.rules.document_page_break = () =>
  '<hr aria-label="分页 / Page break" style="break-after:page" />\n';

markdownRenderer.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noreferrer noopener');
  return renderer.renderToken(tokens, index, options);
};

export const renderSafeMarkdown = (content: string) => markdownRenderer.render(content);
