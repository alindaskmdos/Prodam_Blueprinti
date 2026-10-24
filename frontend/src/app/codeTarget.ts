import type { LineSpan } from './store';

/** Класс/поле общего выбора (project-tree `selectStructure`): файл и span объявления. */
export interface StructureTarget {
  path: string;
  span: LineSpan | null;
}

/** Что открыть во вкладке «Код Java». */
export interface CodeTargetInput {
  /** Файл выбранного метода (из дерева проекта); метода нет или файл не найден — null. */
  methodPath: string | null;
  selectedMethodId: string | null;
  /** Выбранный класс/поле (дерево, UML, граф зависимостей, палитра). */
  structure: StructureTarget | null;
  /** Выбранная проблема (из анализа): methodId и span. */
  issue: { methodId?: string | null; span: LineSpan } | null;
}

export type CodeTarget =
  | { kind: 'issue'; path: string }
  | { kind: 'class'; path: string; span: LineSpan | null }
  | { kind: 'method'; path: string | null }
  | { kind: 'none' };

/**
 * Файл для вкладки «Код Java». Проблема без метода (уровня класса/проекта, напр. CyclicDependency — без
 * blockId) открывает файл своего span: в файле выбранного метода её строк нет. Затем выбранный класс/поле —
 * он новее метода (выбор метода снимает выбор класса, а выбор класса — проблему). Затем метод.
 */
export function codeTarget({ methodPath, selectedMethodId, structure, issue }: CodeTargetInput): CodeTarget {
  if (issue && !issue.methodId) return { kind: 'issue', path: issue.span.file };
  if (structure) return { kind: 'class', path: structure.path, span: structure.span };
  if (selectedMethodId) return { kind: 'method', path: methodPath };
  return { kind: 'none' };
}
