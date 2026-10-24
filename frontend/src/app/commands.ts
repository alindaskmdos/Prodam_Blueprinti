import { useUploadUi } from '../features/upload';
import { useAppStore } from './store';

/** Пользовательское действие: кнопка в UI и пункт командной палитры (Ctrl+K). */
export interface CommandDef {
  /** Уникальный id, напр. 'project.run', 'project.export.zip'. */
  id: string;
  title: string;
  /** Группа в палитре, напр. 'Проект', 'Тесты'. */
  group?: string;
  /** Подсказка сочетания клавиш, напр. 'Ctrl+Enter'. */
  shortcut?: string;
  /** false — команда видна, но недоступна (напр. нет Docker). */
  isEnabled?: () => boolean;
  run: () => void | Promise<void>;
}

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
];

export function findCommand(id: string): CommandDef | undefined {
  return commands.find((c) => c.id === id);
}

/** Выполнить команду из реестра (кнопки UI), если она доступна. */
export function runCommand(id: string): void {
  const command = findCommand(id);
  if (command && (command.isEnabled?.() ?? true)) void command.run();
}
