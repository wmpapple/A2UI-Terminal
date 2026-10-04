import { createContext, useContext } from 'react';

export const WorkspacePanelsContext = createContext<{
  leftAvailable: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
} | null>(null);

export const useWorkspacePanels = () => useContext(WorkspacePanelsContext);
