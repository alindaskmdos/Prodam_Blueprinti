import { createContext, useContext } from 'react';

/** Сворачивание контейнеров (FE-06): ноды получают действие через контекст. */
export interface CollapseApi {
  /** Свернуть (true) / развернуть (false) контейнер по ключу (GraphNodeData.collapse.key). */
  setCollapsed: (key: string, collapsed: boolean) => void;
}

export const CollapseContext = createContext<CollapseApi | null>(null);

export function useCollapse(): CollapseApi | null {
  return useContext(CollapseContext);
}
