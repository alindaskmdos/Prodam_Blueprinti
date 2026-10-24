import { create } from 'zustand';

/** Выбор проблемы в панели анализа: id проблемы, её метод и блок (для центрирования ноды, FE-05). */
export interface IssueSelection {
  issueId: string;
  /** Issue.methodId; нет — выбранный метод не меняется, а selectedBlockId сбрасывается. */
  methodId?: string | null;
  blockId: string;
}

/** Общее состояние приложения: открытый проект, его версия, выбранный метод и проблема. */
export interface AppState {
  projectId: string | null;
  /** Версия проекта из последнего ответа бэка (§12: уходит с правками, на 409 — перезагрузка). */
  version: number | null;
  /** id метода/конструктора из дерева (MethodNode.id), тело которого открыто на холсте. */
  selectedMethodId: string | null;
  /** Issue.id выбранной в панели анализа проблемы. */
  selectedIssueId: string | null;
  /** Issue.blockId выбранной проблемы — нода, которую холст должен показать (FE-05). */
  selectedBlockId: string | null;
  /** Открыть проект: сбрасывает выбранный метод и проблему. */
  openProject: (projectId: string, version?: number | null) => void;
  setVersion: (version: number) => void;
  /** Выбрать метод (дерево проекта): выбранная проблема сбрасывается. */
  selectMethod: (methodId: string | null) => void;
  /** Выбрать проблему (панель анализа): метод проблемы + issueId/blockId; `null` — снять выбор проблемы. */
  selectIssue: (selection: IssueSelection | null) => void;
}

const initial = {
  projectId: null,
  version: null,
  selectedMethodId: null,
  selectedIssueId: null,
  selectedBlockId: null,
};

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
    set({ projectId, version, selectedMethodId: null, selectedIssueId: null, selectedBlockId: null });
  },
  setVersion: (version) => set({ version }),
  selectMethod: (selectedMethodId) => set({ selectedMethodId, selectedIssueId: null, selectedBlockId: null }),
  selectIssue: (selection) => {
    if (!selection) {
      set({ selectedIssueId: null, selectedBlockId: null });
      return;
    }
    const { issueId, methodId, blockId } = selection;
    // Без methodId неизвестно, в каком методе блок: blockId не ставим, чтобы холст не искал его в чужом методе.
    set(
      methodId
        ? { selectedIssueId: issueId, selectedBlockId: blockId, selectedMethodId: methodId }
        : { selectedIssueId: issueId, selectedBlockId: null },
    );
  },
}));

/** Сброс к начальному состоянию (тесты). */
export function resetAppState(): void {
  useAppStore.setState({ ...initial });
}
