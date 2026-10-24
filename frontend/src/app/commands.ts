import { useAnalysisStore } from '../features/analysis-panel/analysisStore';
import { isFixRunning, useFixStore } from '../features/fix';
import { sandboxDisabledReason, useSandboxStore } from '../features/sandbox';
import { useUploadUi } from '../features/upload';
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
  {
    id: 'view.uml',
    title: 'Открыть UML-диаграмму',
    group: 'Вид',
    isEnabled: () => useAppStore.getState().projectId !== null,
    run: () => useAppStore.getState().showPanel('canvas', 'canvas.uml'),
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
