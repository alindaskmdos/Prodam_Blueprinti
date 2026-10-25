import { create } from 'zustand';
import type { Schemas } from '../../api';
import { useAppStore } from '../../../app/store';
import { applyTree, getTreeClient, reloadProjectTree, useTreeStore } from '../treeStore';
import type { EditResult, MemberKind } from './edits';
import { findClassByFqn, findMethod, type ClassRef } from './resolve';

/** id вкладки «Свойства» правой панели (реестр `app/panels.ts`). */
export const STRUCTURE_PANEL_ID = 'structure.props';

/** Выбранный в дереве класс или поле. Метод/конструктор — `useAppStore().selectedMethodId`. */
export type StructureSelection = { kind: 'class'; ref: ClassRef } | { kind: 'field'; ref: ClassRef; field: string };

export type DeleteTarget =
  | { kind: 'class'; ref: ClassRef }
  | { kind: 'field'; ref: ClassRef; field: string }
  | { kind: 'method'; ref: ClassRef; methodId: string };

export type StructureDialog =
  | { kind: 'new-class'; pkg: string | null }
  | { kind: 'new-member'; member: MemberKind; ref: ClassRef }
  | { kind: 'delete'; target: DeleteTarget };

/** Ошибка записи: 422 PARSE_ERROR (line), 409, сеть, ненадёжная правка текста. */
export interface SaveError {
  message: string;
  line?: number;
}

interface StructureState {
  selection: StructureSelection | null;
  /** Растёт на каждый выбор класса/поля (и повторный): код снова прокручивается к его span (FE-16). */
  selectSeq: number;
  dialog: StructureDialog | null;
  /** Идёт запись файла (GET + PUT files). */
  saving: boolean;
  error: SaveError | null;
}

const initial: StructureState = { selection: null, selectSeq: 0, dialog: null, saving: false, error: null };

export const useStructureStore = create<StructureState>()(() => ({ ...initial }));

// Выбор метода (дерево, палитра, проблема) снимает выбор класса/поля: в «Свойствах» — форма метода.
useAppStore.subscribe((s, prev) => {
  if (s.selectedMethodId !== prev.selectedMethodId || s.methodSelectSeq !== prev.methodSelectSeq) {
    const keep = s.selectedMethodId === null ? useStructureStore.getState().selection : null;
    useStructureStore.setState({ selection: keep, error: null });
  }
  // Выбор новее выбранного класса — проблема (из панели, палитры, графа) или клик по ноде холста: код и
  // «Свойства» переходят к нему, выбор класса снимается (приоритет — по последнему действию, FE-16).
  const newerIssue = s.selectedIssueId !== null && s.selectedIssueId !== prev.selectedIssueId;
  const newerCanvas = s.highlight?.source === 'canvas' && s.highlight !== prev.highlight;
  if ((newerIssue || newerCanvas) && useStructureStore.getState().selection !== null) {
    useStructureStore.setState({ selection: null, error: null });
  }
  if (s.projectId !== prev.projectId) useStructureStore.setState({ ...initial });
});

/**
 * Единый выбор класса/поля (дерево, UML, граф зависимостей, палитра): форма во вкладке «Свойства», вкладка
 * «Код Java» открывает файл класса и прокручивает к span класса/поля (`app/codeTarget.ts`); выбранная
 * проблема снимается, чтобы код показывал класс, а не её строки.
 */
export function selectStructure(selection: StructureSelection | null): void {
  useStructureStore.setState((s) => ({ selection, error: null, selectSeq: selection ? s.selectSeq + 1 : s.selectSeq }));
  if (!selection) return;
  // Схема выбранного метода остаётся на холсте; повторный клик по методу вернёт его форму.
  const app = useAppStore.getState();
  if (app.selectedIssueId !== null) app.selectIssue(null);
  if (app.highlight !== null) app.setHighlight(null);
  app.showPanel('right', STRUCTURE_PANEL_ID);
  app.showPanel('bottom', 'bottom.code');
}

/**
 * Общий API выбора класса (UML/граф зависимостей и др.): FQN (`pkg.Outer.Inner`, = UmlClass.id) → класс
 * выбран в дереве, его форма открыта во вкладке «Свойства». Класса нет в дереве — false.
 */
export function selectClass(fqn: string): boolean {
  const tree = useTreeStore.getState().state;
  if (tree.kind !== 'ok') return false;
  const found = findClassByFqn(tree.tree, fqn);
  if (!found) return false;
  selectStructure({ kind: 'class', ref: { path: found.path, name: found.cls.name } });
  return true;
}

/** Класс, к которому относятся команды «Новое поле/метод»: выбранный класс/поле или класс выбранного метода. */
export function currentClassRef(): ClassRef | null {
  const { selection } = useStructureStore.getState();
  if (selection) return selection.ref;
  const methodId = useAppStore.getState().selectedMethodId;
  const tree = useTreeStore.getState().state;
  if (!methodId || tree.kind !== 'ok') return null;
  const found = findMethod(tree.tree, methodId);
  return found ? { path: found.path, name: found.cls.name } : null;
}

export function openStructureDialog(dialog: StructureDialog): void {
  useStructureStore.setState({ dialog, error: null });
}

export function closeStructureDialog(): void {
  if (!useStructureStore.getState().saving) useStructureStore.setState({ dialog: null, error: null });
}

export function clearStructureError(): void {
  useStructureStore.setState({ error: null });
}

/** Сброс (тесты). */
export function resetStructureState(): void {
  useStructureStore.setState({ ...initial });
}

export type SaveOutcome = { ok: true; result: Schemas['MutationResult'] } | { ok: false };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Правка текста файла формой (решение 2026-10-25): GET files → `transform(текст, дерево)` → PUT files с полным
 * текстом и версией файла. Дерево старше текста — сначала перезагружается (позиции span должны быть от того же
 * текста). 200 → дерево из ответа, версия → store (Monaco и холст перечитывают по версии, анализ — тоже);
 * 409 → перезагрузка дерева и ошибка «повторите»; 422 → ошибка с line, текст не применён.
 */
export async function saveFileEdit(
  path: string,
  transform: (text: string, tree: Schemas['ProjectTree']) => EditResult,
): Promise<SaveOutcome> {
  const client = getTreeClient();
  const projectId = useTreeStore.getState().projectId;
  if (!client || !projectId) return failWith({ message: 'Проект не открыт' });
  if (useStructureStore.getState().saving) return { ok: false };
  useStructureStore.setState({ saving: true, error: null });
  try {
    const got = await client.GET('/projects/{projectId}/files', { params: { path: { projectId }, query: { path } } });
    if (!got.data) return failWith({ message: got.error?.message ?? `HTTP ${got.response.status}` });
    const file = got.data;
    let tree = currentTree();
    if (!tree || tree.version !== file.version) {
      await reloadProjectTree();
      tree = currentTree();
    }
    if (!tree || tree.version !== file.version) {
      return failWith({ message: 'Дерево проекта и текст файла рассинхронизированы — повторите' });
    }
    const edit = transform(file.text, tree);
    if (!edit.ok) return failWith({ message: edit.reason });
    if (edit.text === file.text) {
      useStructureStore.setState({ saving: false });
      return { ok: false };
    }
    const put = await client.PUT('/projects/{projectId}/files', {
      params: { path: { projectId }, query: { path } },
      body: { version: file.version, text: edit.text },
    });
    if (put.data) {
      applyTree(projectId, put.data.tree, put.data.version);
      useStructureStore.setState({ saving: false, error: null });
      return { ok: true, result: put.data };
    }
    if (put.response.status === 409) {
      void reloadProjectTree();
      return failWith({ message: 'Проект изменён другим действием — дерево перезагружено, проверьте и сохраните снова' });
    }
    if (put.response.status === 422 && put.error) {
      return failWith({ message: put.error.message, line: put.error.line });
    }
    return failWith({ message: put.error?.message ?? `HTTP ${put.response.status}` });
  } catch (e: unknown) {
    return failWith({ message: errorText(e) });
  }
}

function currentTree(): Schemas['ProjectTree'] | null {
  const s = useTreeStore.getState().state;
  return s.kind === 'ok' ? s.tree : null;
}

function failWith(error: SaveError): { ok: false } {
  useStructureStore.setState({ saving: false, error });
  return { ok: false };
}
