import { desktopGateway } from '../../shared/platform/gateway';
import type {
  CreateSceneTool,
  SaveSceneTool,
  SetSceneLink,
  ConfirmSceneLink,
  ToolBinding,
  PublishSceneTool,
  RenameSceneTool,
  ResetSceneTool,
} from '../../shared/types/sceneTool';

export const sceneToolController = {
  list: () => desktopGateway.listSceneTools(),
  publish: (input: PublishSceneTool) => desktopGateway.publishSceneTool(input),
  listTemplates: (locale: string) => desktopGateway.listSceneTemplates(locale),
  create: (input: CreateSceneTool, binding?: ToolBinding) =>
    desktopGateway.createSceneTool(input, binding),
  readLink: (id: string) => desktopGateway.readToolBinding(id),
  setLink: async (input: SetSceneLink) => {
    const view = await desktopGateway.setToolBinding(input);
    window.dispatchEvent(new Event('scene-tool-list-changed'));
    return view;
  },
  confirmLink: (input: ConfirmSceneLink) => desktopGateway.confirmToolBinding(input),
  listLinked: (binding: ToolBinding) => desktopGateway.listBoundTools(binding),
  listTargets: () => desktopGateway.listToolBindingTargets(),
  read: (id: string) => desktopGateway.readSceneTool(id),
  save: (input: SaveSceneTool) => desktopGateway.saveSceneTool(input),
  rename: async (input: RenameSceneTool) => {
    const view = await desktopGateway.renameSceneTool(input);
    window.dispatchEvent(new Event('scene-tool-list-changed'));
    return view;
  },
  reset: (input: ResetSceneTool) => desktopGateway.resetSceneTool(input),
  delete: async (id: string) => {
    await desktopGateway.deleteResult(id);
    window.dispatchEvent(new Event('scene-tool-list-changed'));
  },
  openTemplate: (id: string, binding?: ToolBinding) =>
    desktopGateway.openSceneTemplate(id, binding),
  listSavedTemplates: () =>
    desktopGateway.listA2uiTemplates('00000000-0000-4000-8000-000000000001'),
  deleteTemplate: (id: string) =>
    desktopGateway.deleteA2uiTemplate('00000000-0000-4000-8000-000000000001', id),
};
