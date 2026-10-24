import { create } from 'zustand';

/** Выбор проблемы в панели анализа: id проблемы, её метод и блок (для центрирования ноды, FE-05). */
export interface IssueSelection {
  issueId: string;
  /** Issue.methodId; нет — выбранный метод не меняется, а selectedBlockId сбрасывается. */
  methodId?: string | null;
  /** Issue.blockId; нет у находок уровня класса/проекта (CyclicDependency). */
  blockId?: string | null;
}

/** Строки фрагмента кода, как Span контракта (с 1, включительно). */
export interface LineSpan {
  file: string;
  startLine: number;
  endLine: number;
}

/**
 * Подсветка «строка ↔ нода» (FE-05). Каждая сторона пишет только своё событие и реагирует только на чужое:
 * холст (клик по ноде) → `canvas` с блоком и его span → Monaco подсвечивает строки; курсор Monaco → `code`
 * со строкой → холст подсвечивает самый глубокий блок; выбор проблемы → `issue` (холст центрирует ноду,
 * Monaco прокручивает к span проблемы). Ответных записей нет — циклов «подсветка → событие → подсветка» нет.
 */
export interface Highlight {
  source: 'canvas' | 'code' | 'issue';
  /** canvas / issue: блок (Block.id). */
  blockId: string | null;
  /** canvas: span блока; code: файл и строка курсора (startLine = endLine); issue: null (span — у Issue). */
  span: LineSpan | null;
  /** Растёт на каждое событие: повторный клик по той же проблеме снова центрирует. */
  seq: number;
}

/** Выбранный класс (UML / граф зависимостей → редактор, FE-16): FQN, файл и span объявления для прокрутки кода. */
export interface ClassSelection {
  /** FQN через точки (= UmlClass.id = ClassNode.fqn). */
  id: string;
  /** Файл класса (ProjectFile.path). */
  path: string;
  /** Span объявления класса; нет — файл открывается без прокрутки. */
  span: LineSpan | null;
}

/** Общее состояние приложения: открытый проект, его версия, выбранный метод и проблема. */
export interface AppState {
  projectId: string | null;
  /** Версия проекта из последнего ответа бэка (§12: уходит с правками, на 409 — перезагрузка). */
  version: number | null;
  /** id метода/конструктора из дерева (MethodNode.id), тело которого открыто на холсте. */
  selectedMethodId: string | null;
  /** Растёт на каждый вызов selectMethod, в т.ч. по уже выбранному методу: повторный клик снова прокручивает код (FE-35). */
  methodSelectSeq: number;
  /** Выбранный класс (FE-16); выбор метода или проблемы его сбрасывает. */
  selectedClass: ClassSelection | null;
  /** Растёт на каждый selectClass: повторный клик по тому же классу снова прокручивает код. */
  classSelectSeq: number;
  /** Issue.id выбранной в панели анализа проблемы. */
  selectedIssueId: string | null;
  /** Issue.blockId выбранной проблемы — нода, которую холст должен показать (FE-05). */
  selectedBlockId: string | null;
  /** Последнее событие подсветки строка ↔ нода (FE-05); null — ничего не подсвечено. */
  highlight: Highlight | null;
  /** Активная вкладка панели по зоне ('right' | 'bottom' → id из panels.ts); нет ключа — первая вкладка. */
  activePanels: Record<string, string>;
  /** Открыть вкладку панели (напр. результаты запуска → showPanel('bottom', 'bottom.tests')). */
  showPanel: (area: string, panelId: string) => void;
  /** Открыть проект: сбрасывает выбранный метод и проблему. */
  openProject: (projectId: string, version?: number | null) => void;
  setVersion: (version: number) => void;
  /** Выбрать метод (дерево проекта): выбранная проблема сбрасывается. */
  selectMethod: (methodId: string | null) => void;
  /** Выбрать класс (UML, граф зависимостей): выбранный метод и проблема сбрасываются; `null` — снять. */
  selectClass: (selection: ClassSelection | null) => void;
  /** Выбрать проблему (панель анализа): метод проблемы + issueId/blockId; `null` — снять выбор проблемы. */
  selectIssue: (selection: IssueSelection | null) => void;
  /** Подсветка от холста (`canvas`) или редактора кода (`code`); null — снять. */
  setHighlight: (highlight: { source: 'canvas' | 'code'; blockId?: string | null; span?: LineSpan | null } | null) => void;
}

const initial = {
  projectId: null,
  version: null,
  selectedMethodId: null,
  methodSelectSeq: 0,
  selectedClass: null as ClassSelection | null,
  classSelectSeq: 0,
  selectedIssueId: null,
  selectedBlockId: null,
  highlight: null,
  activePanels: {} as Record<string, string>,
};

let highlightSeq = 0;
const nextSeq = () => ++highlightSeq;

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
    set({ projectId, version, selectedMethodId: null, selectedClass: null, selectedIssueId: null, selectedBlockId: null, highlight: null });
  },
  setVersion: (version) => set({ version }),
  selectMethod: (selectedMethodId) =>
    set((s) => ({
      selectedMethodId,
      methodSelectSeq: s.methodSelectSeq + 1,
      selectedClass: null,
      selectedIssueId: null,
      selectedBlockId: null,
      highlight: null,
    })),
  selectClass: (selectedClass) =>
    set((s) =>
      selectedClass
        ? {
            selectedClass,
            classSelectSeq: s.classSelectSeq + 1,
            selectedMethodId: null,
            selectedIssueId: null,
            selectedBlockId: null,
            highlight: null,
          }
        : { selectedClass: null },
    ),
  showPanel: (area, panelId) => set((s) => ({ activePanels: { ...s.activePanels, [area]: panelId } })),
  selectIssue: (selection) => {
    if (!selection) {
      const h = get().highlight;
      set({ selectedIssueId: null, selectedBlockId: null, ...(h?.source === 'issue' ? { highlight: null } : {}) });
      return;
    }
    const { issueId, methodId } = selection;
    const blockId = selection.blockId ?? null;
    // Без methodId неизвестно, в каком методе блок: blockId не ставим, чтобы холст не искал его в чужом методе.
    set(
      methodId
        ? {
            selectedClass: null,
            selectedIssueId: issueId,
            selectedBlockId: blockId,
            selectedMethodId: methodId,
            highlight: { source: 'issue', blockId, span: null, seq: nextSeq() },
          }
        : { selectedClass: null, selectedIssueId: issueId, selectedBlockId: null, highlight: { source: 'issue', blockId: null, span: null, seq: nextSeq() } },
    );
  },
  setHighlight: (h) =>
    set({ highlight: h ? { source: h.source, blockId: h.blockId ?? null, span: h.span ?? null, seq: nextSeq() } : null }),
}));

/** Сброс к начальному состоянию (тесты). */
export function resetAppState(): void {
  useAppStore.setState({ ...initial });
}
