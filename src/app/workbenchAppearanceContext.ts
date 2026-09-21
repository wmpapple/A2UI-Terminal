import { createContext } from 'react';

export const WorkbenchAppearanceContext = createContext<{
  enabled: boolean;
  changeMode: (enabled: boolean) => void;
} | null>(null);
