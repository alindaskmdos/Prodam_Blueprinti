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
export const commands: readonly CommandDef[] = [];

export function findCommand(id: string): CommandDef | undefined {
  return commands.find((c) => c.id === id);
}
