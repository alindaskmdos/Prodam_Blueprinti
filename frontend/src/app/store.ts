import { create } from 'zustand';

/** Общее состояние приложения: открытый проект, его версия и выбранный метод. */
export interface AppState {
  projectId: string | null;
  /** Версия проекта из последнего ответа бэка (§12: уходит с правками, на 409 — перезагрузка). */
  version: number | null;
  /** id метода/конструктора из дерева (MethodNode.id), тело которого открыто на холсте. */
  selectedMethodId: string | null;
  /** Открыть проект: сбрасывает выбранный метод. */
  openProject: (projectId: string, version?: number | null) => void;
  setVersion: (version: number) => void;
  selectMethod: (methodId: string | null) => void;
}

const initial = { projectId: null, version: null, selectedMethodId: null };

/**
 * Store на zustand: в компонентах — `useAppStore((s) => s.selectedMethodId)`,
 * вне React (команды) — `useAppStore.getState()`.
 */
export const useAppStore = create<AppState>()((set, get) => ({
  ...initial,
  openProject: (projectId, version = null) => {
    if (get().projectId === projectId) {
      if (version !== null) set({ version });
      return;
    }
    set({ projectId, version, selectedMethodId: null });
  },
  setVersion: (version) => set({ version }),
  selectMethod: (selectedMethodId) => set({ selectedMethodId }),
}));

/** Сброс к начальному состоянию (тесты). */
export function resetAppState(): void {
  useAppStore.setState({ ...initial });
}
