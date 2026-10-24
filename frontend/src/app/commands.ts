import { useAnalysisStore } from '../features/analysis-panel/analysisStore';
import { isFixRunning, useFixStore } from '../features/fix';
import { sandboxDisabledReason, useSandboxStore } from '../features/sandbox';
import { useUploadUi } from '../features/upload';
import { currentClassRef, openStructureDialog, useTreeStore } from '../features/project-tree';
import { useLayoutStore } from '../features/layout/layoutStore';
import { useAppStore } from './store';

/** Запуск/проверка доступны: проект открыт, песочница доступна, ничего не выполняется. */
function sandboxReady(): boolean {
  const sandbox = useSandboxStore.getState();
  return (
    useAppStore.getState().projectId !== null &&
    sandbox.client !== null &&
    sandboxDisabledReason(sandbox) === null &&
    sandbox.busy === null &&
    !isFixRunning(useFixStore.getState().gate)
  );
}

/** Дерево открытого проекта загружено (формы структуры работают по нему). */
function treeReady(): boolean {
  const tree = useTreeStore.getState();
  const { projectId } = useAppStore.getState();
  return projectId !== null && tree.projectId === projectId && tree.state.kind === 'ok';
}

/** Диалог нового члена для выбранного класса (класс/поле в дереве или класс выбранного метода). */
function openMember(member: 'field' | 'constructor' | 'method'): void {
  const ref = currentClassRef();
  if (ref) openStructureDialog({ kind: 'new-member', member, ref });
}

/** Пользовательское действие: кнопка в UI и пункт командной палитры (Ctrl+K). */
export interface CommandDef {
  /** Уникальный id, напр. 'project.run', 'project.export.zip'. */
  id: string;
  title: string;
  /** Группа в палитре, напр. 'Проект', 'Тесты'. */
  group?: string;
  /** Подсказка сочетания клавиш, напр. 'Ctrl+Enter'. */
  shortcut?: string;
  /** true — команда нужна только UI с параметрами (fix.apply) и в палитре не показывается. */
  paletteHidden?: boolean;
  /** false — команда видна, но недоступна (напр. нет Docker). */
  isEnabled?: () => boolean;
  /** `args` — параметры команды из UI (напр. fix.apply: issueId, fixId). */
  run: (args?: CommandArgs) => void | Promise<void>;
}

/** Параметры команды: строки по имени. */
export type CommandArgs = Readonly<Record<string, string>>;

/** Реестр команд. Новое действие = новый элемент списка. */
export const commands: readonly CommandDef[] = [
  {
    id: 'project.upload',
    title: 'Загрузить проект',
    group: 'Проект',
    run: () => useUploadUi.getState().openUpload(),
  },
  {
    id: 'project.export',
    title: 'Экспорт проекта (.zip / .jar)',
    group: 'Проект',
    isEnabled: () => useAppStore.getState().projectId !== null,
    run: () => useUploadUi.getState().openExport(),
  },
  {
    id: 'project.run',
    title: 'Запуск программы',
    group: 'Запуск',
    isEnabled: sandboxReady,
    run: () => useSandboxStore.getState().openRun(),
  },
  {
    id: 'project.verify',
    title: 'Проверить поведение (все тесты)',
    group: 'Запуск',
    isEnabled: sandboxReady,
    run: () => useSandboxStore.getState().verify(),
  },
  // FE-10: структура проекта — диалоги project-tree, правка текста файла через PUT files.
  {
    id: 'structure.newClass',
    title: 'Новый класс',
    group: 'Структура',
    isEnabled: treeReady,
    run: () => openStructureDialog({ kind: 'new-class', pkg: null }),
  },
  {
    id: 'structure.newField',
    title: 'Новое поле (в выбранном классе)',
    group: 'Структура',
    isEnabled: () => treeReady() && currentClassRef() !== null,
    run: () => openMember('field'),
  },
  {
    id: 'structure.newConstructor',
    title: 'Новый конструктор (в выбранном классе)',
    group: 'Структура',
    isEnabled: () => treeReady() && currentClassRef() !== null,
    run: () => openMember('constructor'),
  },
  {
    id: 'structure.newMethod',
    title: 'Новый метод (в выбранном классе)',
    group: 'Структура',
    isEnabled: () => treeReady() && currentClassRef() !== null,
    run: () => openMember('method'),
  },
  // Панели: сворачивание в пользу холста (горячие клавиши — layoutShortcuts.ts).
  {
    id: 'layout.toggleLeft',
    title: 'Показать/скрыть дерево проекта',
    group: 'Вид',
    shortcut: 'Ctrl+B',
    run: () => useLayoutStore.getState().toggle('left'),
  },
  {
    id: 'layout.toggleBottom',
    title: 'Показать/скрыть нижнюю панель (код, консоль, тесты)',
    group: 'Вид',
    shortcut: 'Ctrl+J',
    run: () => useLayoutStore.getState().toggle('bottom'),
  },
  {
    id: 'layout.toggleRight',
    title: 'Показать/скрыть панель анализа',
    group: 'Вид',
    shortcut: 'Ctrl+Alt+B',
    run: () => useLayoutStore.getState().toggle('right'),
  },
  {
    id: 'layout.canvasOnly',
    title: 'Только схема (свернуть все панели / вернуть)',
    group: 'Вид',
    shortcut: 'Ctrl+\\',
    run: () => useLayoutStore.getState().toggleCanvasOnly(),
  },
  {
    id: 'view.uml',
    title: 'Открыть UML-диаграмму',
    group: 'Вид',
    isEnabled: () => useAppStore.getState().projectId !== null,
    run: () => useAppStore.getState().showPanel('canvas', 'canvas.uml'),
  },
  {
    id: 'view.dependencies',
    title: 'Открыть граф зависимостей классов',
    group: 'Вид',
    isEnabled: () => useAppStore.getState().projectId !== null,
    run: () => useAppStore.getState().showPanel('canvas', 'canvas.deps'),
  },
  {
    // Кнопка «Применить» в карточке проблемы: args = { issueId, fixId } (fixId — из Issue.fixes).
    id: 'fix.apply',
    title: 'Применить фикс (Quality Gate)',
    group: 'Анализ',
    // В палитре фиксы показываются по проблемам (command-palette), а не одной командой без параметров.
    paletteHidden: true,
    isEnabled: sandboxReady,
    run: (args) => {
      const issueId = args?.issueId;
      const fixId = args?.fixId;
      const { analysis } = useAnalysisStore.getState();
      const { projectId } = useAppStore.getState();
      const { client } = useSandboxStore.getState();
      const issue = analysis?.issues.find((i) => i.id === issueId);
      if (!analysis || !issue || !fixId || !issue.fixes.includes(fixId) || !projectId || !client) return;
      // Версия — анализа, из которого взят Issue: issueId действителен только для неё.
      return useFixStore.getState().apply(client, projectId, issue, fixId, analysis.version);
    },
  },
];

export function findCommand(id: string): CommandDef | undefined {
  return commands.find((c) => c.id === id);
}

/** Выполнить команду из реестра (кнопки UI), если она доступна. */
export function runCommand(id: string, args?: CommandArgs): void {
  const command = findCommand(id);
  if (command && (command.isEnabled?.() ?? true)) void command.run(args);
}
