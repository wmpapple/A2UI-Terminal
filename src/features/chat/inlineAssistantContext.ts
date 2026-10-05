import type { WritingProject, WritingSection } from '../../shared/types/writingProject';
import type { ContextSelection } from '../../shared/types/domain';
import { useSceneToolStore } from '../sceneTools/sceneToolStore';
import type { LinkedMaterial } from './useToolLinkedMaterial';

export function projectInlineContext(
  project: WritingProject | null | undefined,
  section?: WritingSection | null
) {
  return {
    id: project
      ? `project:${project.id}:${project.revision}:${section?.id ?? 'overview'}`
      : 'project:new',
    title: section?.title ?? project?.config.title ?? 'New writing project',
    content: project
      ? JSON.stringify(
          {
            title: project.config.title,
            goal: project.config.goal,
            audience: project.config.audience,
            facts: project.config.facts,
            terminology: project.config.terminology,
            outline: project.sections.map((item, index) => ({
              title: item.title,
              objective: item.objective,
              accepted: item.accepted,
              summary:
                !section ||
                (index < project.sections.findIndex((candidate) => candidate.id === section.id) &&
                  item.accepted)
                  ? item.summary
                  : undefined,
            })),
            currentSection: section
              ? {
                  title: section.title,
                  objective: section.objective,
                  content: section.content,
                  summary: section.summary,
                }
              : undefined,
          },
          null,
          2
        )
      : '',
    selection: {
      selection: Boolean(project),
      currentFile: false,
      recentMessages: false,
      recentMessageCount: 3,
      projectFiles: [],
      documentSourceIds: project?.config.documentSourceIds ?? [],
      personalKnowledgeIds: project?.config.knowledgeIds ?? [],
      contextPackIds: project?.config.contextPackIds ?? [],
    },
  };
}

export function assistantTargetLabel(
  project: WritingProject | null | undefined,
  section: WritingSection | null | undefined,
  toolMode: boolean,
  toolTitle: string,
  activePath: string,
  workspaceName: string,
  fallback: string
) {
  return (
    section?.title ??
    project?.config.title ??
    (project !== undefined
      ? fallback
      : toolMode
        ? toolTitle || 'My Tools'
        : activePath || workspaceName)
  );
}

export function toolInlineContext(
  toolId: string | null | undefined,
  toolTitle: string,
  toolEntry: ReturnType<typeof useSceneToolStore.getState>['entries'][string] | undefined
) {
  return {
    id: toolId ?? 'no-tool',
    title: toolTitle,
    content: toolEntry?.view
      ? JSON.stringify({ tool: toolTitle, fields: toolEntry.data }, null, 2)
      : '',
  };
}

export function hasSelectedMaterial(selection: ContextSelection, material: LinkedMaterial | null) {
  const linkedSelected =
    material?.kind === 'projectFile'
      ? selection.projectFiles.includes(material.id)
      : material?.kind === 'documentSource'
        ? (selection.documentSourceIds ?? []).includes(material.id)
        : false;
  return {
    linkedSelected,
    anySelected:
      linkedSelected ||
      selection.projectFiles.length > 0 ||
      (selection.documentSourceIds?.length ?? 0) > 0 ||
      (selection.personalKnowledgeIds?.length ?? 0) > 0 ||
      (selection.contextPackIds?.length ?? 0) > 0,
  };
}
