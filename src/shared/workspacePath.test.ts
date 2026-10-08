import { describe, expect, it } from 'vitest';
import {
  displayCanvasBindingPath,
  displayCanvasTitle,
  displayWorkspacePath,
  workspaceFolderPaths,
} from './workspacePath';

describe('workspace path presentation', () => {
  const imported = 'selected/6e3a49c1-0d72-4cda-8f2a-37a91284e071/README.md';

  it('shows imported files by name while preserving real workspace paths', () => {
    expect(displayWorkspacePath(imported)).toBe('README.md');
    expect(displayWorkspacePath('docs/paper.md')).toBe('docs/paper.md');
    expect(workspaceFolderPaths([imported, 'docs/paper.md'])).toEqual(['docs']);
  });

  it('gives legacy canvases bound to an imported file an understandable label', () => {
    const binding = 'selected/6e3a49c1-0d72-4cda-8f2a-37a91284e071';
    expect(displayCanvasBindingPath(binding, [imported])).toBe('README.md');
    expect(displayCanvasTitle('文件夹 · 画布', binding, [imported])).toBe('README.md · 画布');
    expect(displayCanvasTitle('我的研究', binding, [imported])).toBe('我的研究');
  });
});
