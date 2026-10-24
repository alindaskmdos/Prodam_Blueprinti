import { createContext, useContext } from 'react';
import type { BlockPath } from './blockEdit';

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
}

/** null — схема только для просмотра (MethodGraph без синхронизации). */
export const NodeEditContext = createContext<NodeEditApi | null>(null);

export function useNodeEdit(): NodeEditApi | null {
  return useContext(NodeEditContext);
}
