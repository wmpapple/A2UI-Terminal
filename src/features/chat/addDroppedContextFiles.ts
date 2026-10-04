import { message } from 'antd';
import type { WorkspaceFile } from '../../shared/types/domain';

export async function addDroppedContextFiles(
  files: FileList,
  sessionId: string,
  addFile: (file: WorkspaceFile) => void,
  addFileToContext: (sessionId: string, path: string) => void,
  unsupportedLabel: string
) {
  const supported = /\.(txt|md|json|ts|tsx|js|jsx|py|ya?ml|css|html|xml|toml|ini|sql|sh|ps1)$/i;
  for (const file of Array.from(files)) {
    if (!supported.test(file.name) || file.size > 2 * 1024 * 1024) {
      message.warning(`${file.name}: ${unsupportedLabel}`);
      continue;
    }
    const path = `uploads/${file.name}`;
    addFile({
      path,
      name: file.name,
      language: file.name.split('.').pop() ?? 'text',
      content: await file.text(),
    });
    addFileToContext(sessionId, path);
  }
}
