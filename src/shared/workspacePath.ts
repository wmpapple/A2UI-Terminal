/** Imported standalone files use an internal stable key, not a user-facing folder. */
export function isSelectedFilePath(path: string): boolean {
  return /^selected\/[^/]+\/.+/.test(path);
}

export function displayWorkspacePath(path: string): string {
  if (/^selected\/[^/]+$/.test(path)) return '已导入文件';
  return isSelectedFilePath(path) ? path.split('/').slice(2).join('/') : path;
}

export function displayCanvasBindingPath(path: string, filePaths: string[]): string {
  if (!/^selected\/[^/]+$/.test(path)) return displayWorkspacePath(path);
  const matchingFiles = filePaths.filter((file) => file.startsWith(`${path}/`));
  return matchingFiles.length === 1 ? displayWorkspacePath(matchingFiles[0]) : '已导入文件';
}

export function displayCanvasTitle(
  title: string,
  bindingPath: string | null,
  filePaths: string[]
): string {
  if (!bindingPath || !/^selected\/[^/]+$/.test(bindingPath)) return title;
  if (title !== '文件夹 · 画布' && !/^(?:\d{10,}|[0-9a-f]{8}-[0-9a-f-]{27,}) · 画布$/i.test(title))
    return title;
  return `${displayCanvasBindingPath(bindingPath, filePaths)} · 画布`;
}

export function workspaceFolderPaths(filePaths: string[]): string[] {
  return Array.from(
    new Set(
      filePaths.flatMap((path) => {
        if (isSelectedFilePath(path)) return [];
        const parts = path.split('/');
        return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
      })
    )
  ).sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

export function workspaceParentFolder(path: string): string {
  if (isSelectedFilePath(path)) return '';
  return path.split('/').slice(0, -1).join('/');
}
