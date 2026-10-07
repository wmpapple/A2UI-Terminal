import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useImportStore } from '../imports/importStore';
import type { SceneDocumentLink } from '../../shared/types/sceneTool';
import { sceneToolController } from '../sceneTools/sceneToolController';

export type LinkedMaterial = { kind: 'projectFile' | 'documentSource'; id: string; title: string };

export function useToolLinkedMaterial(toolId?: string | null) {
  const [loaded, setLoaded] = useState<{ toolId: string; link: SceneDocumentLink | null } | null>(
    null
  );
  const workspaceId = useAppStore((state) => state.workspace?.id);
  const files = useAppStore((state) => state.files);
  const sources = useImportStore((state) => state.sources);
  useEffect(() => {
    if (!toolId) return;
    let active = true;
    const refresh = () =>
      void sceneToolController
        .readLink(toolId)
        .then((view) => {
          if (active) setLoaded({ toolId, link: view.link });
        })
        .catch(() => {
          if (active) setLoaded({ toolId, link: null });
        });
    refresh();
    window.addEventListener('scene-tool-list-changed', refresh);
    return () => {
      active = false;
      window.removeEventListener('scene-tool-list-changed', refresh);
    };
  }, [toolId]);
  const link = loaded && loaded.toolId === toolId ? loaded.link : null;
  const target = link?.binding.type === 'document' ? link.binding.target : null;
  const sourceId =
    target?.kind === 'workspace_file' && target.workspaceId === workspaceId
      ? target.sourceId
      : null;
  const file = sourceId ? files.find((item) => item.sourceId === sourceId) : null;
  const source = sourceId
    ? sources.find((item) => item.id === sourceId && item.workspaceId === workspaceId)
    : null;
  const material: LinkedMaterial | null = file
    ? { kind: 'projectFile', id: file.path, title: link?.targetTitle ?? file.name }
    : source
      ? { kind: 'documentSource', id: source.id, title: link?.targetTitle ?? source.name }
      : null;
  return { link, material };
}
