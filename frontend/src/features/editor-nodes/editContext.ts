import { createContext, useContext } from 'react';
import type { BlockPath } from './blockEdit';
import type { InsertPoint } from './blockTree';

/** Правка текста нод: ноды React Flow получают состояние и действия через контекст, а не через data. */
export interface NodeEditApi {
  /** Путь ноды, открытой в редакторе. */
  editing: BlockPath | null;
  /** PUT blocks в полёте — редактор только для чтения. */
  saving: boolean;
  /** Метод изменился извне, пока открыт редактор: применить к новому дереву (rebase) или отменить. */
  stale: boolean;
  startEdit: (path: BlockPath) => void;
  /** Значения полей для редактора (черновик красной ноды или текст с сервера). */
  draftFor: (path: BlockPath) => Record<string, string>;
  apply: (path: BlockPath, draft: Record<string, string>) => void;
  rebase: (path: BlockPath, draft: Record<string, string>) => void;
  cancelEdit: () => void;
  discardInvalid: () => void;
  /**
   * Структура (FE-08). false — «+», удаление и вверх/вниз недоступны: есть неотправленная вставка
   * или метод изменился извне (stale).
   */
  structure: boolean;
  /** «+» нажат: открыть меню выбора kind у кнопки anchor. */
  requestInsert: (point: InsertPoint, anchor: HTMLElement) => void;
  /** Удалить блок (у контейнера с содержимым — с подтверждением). */
  remove: (path: BlockPath) => void;
  move: (path: BlockPath, delta: -1 | 1) => void;
  canMove: (path: BlockPath, delta: -1 | 1) => boolean;
}

/** null — схема только для просмотра (MethodGraph без синхронизации). */
export const NodeEditContext = createContext<NodeEditApi | null>(null);

export function useNodeEdit(): NodeEditApi | null {
  return useContext(NodeEditContext);
}
