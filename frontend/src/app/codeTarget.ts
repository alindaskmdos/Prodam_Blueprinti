import type { ClassSelection, LineSpan } from './store';

/** Что открыть во вкладке «Код Java». */
export interface CodeTargetInput {
  /** Файл выбранного метода (из дерева проекта); метода нет или файл не найден — null. */
  methodPath: string | null;
  selectedMethodId: string | null;
  selectedClass: ClassSelection | null;
  /** Выбранная проблема (из анализа): methodId и span. */
  issue: { methodId?: string | null; span: LineSpan } | null;
}

export type CodeTarget =
  | { kind: 'issue'; path: string }
  | { kind: 'method'; path: string | null }
  | { kind: 'class'; path: string; span: LineSpan | null }
  | { kind: 'none' };

/**
 * Файл для вкладки «Код Java». Проблема без метода (уровня класса/проекта, напр. CyclicDependency — без
 * blockId) открывает файл своего span: в файле выбранного метода её строк нет. Затем — метод, затем класс
 * (переход из UML / графа зависимостей).
 */
export function codeTarget({ methodPath, selectedMethodId, selectedClass, issue }: CodeTargetInput): CodeTarget {
  if (issue && !issue.methodId) return { kind: 'issue', path: issue.span.file };
  if (selectedMethodId) return { kind: 'method', path: methodPath };
  if (selectedClass) return { kind: 'class', path: selectedClass.path, span: selectedClass.span };
  return { kind: 'none' };
}
