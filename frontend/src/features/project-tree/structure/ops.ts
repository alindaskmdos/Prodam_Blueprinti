/**
 * Действия форм и диалогов структуры: найти узел в свежем дереве → правка текста (edits.ts) → saveFileEdit.
 * После ответа выбор переносится на изменённый узел (переименование, новый член); выбор удалённого снимается.
 */
import type { Schemas } from '../../api';
import { useAppStore } from '../../../app/store';
import {
  appendClass,
  constructorTemplate,
  deleteClass,
  deleteField,
  deleteMethod,
  editClassHeader,
  editField,
  editMethodHeader,
  fieldTemplate,
  insertMember,
  methodTemplate,
  type EditResult,
  type MemberKind,
} from './edits';
import type { ClassHeaderEdit, ClassKeyword, FieldEdit, MethodHeaderEdit } from './headers';
import { findClass, findMethod, sameRef, type ClassRef } from './resolve';
import { saveFileEdit, selectStructure, useStructureStore, type DeleteTarget } from './structureStore';

type Tree = Schemas['ProjectTree'];
type ClassNode = Schemas['ClassNode'];
type MethodNode = Schemas['MethodNode'];

const NOT_FOUND = 'Объявление не найдено в дереве проекта — возможно, оно уже изменено';

function inClass(ref: ClassRef, edit: (text: string, cls: ClassNode) => EditResult) {
  return (text: string, tree: Tree): EditResult => {
    const found = findClass(tree, ref);
    return found ? edit(text, found.cls) : { ok: false, reason: NOT_FOUND };
  };
}

/** Имя класса после переименования: последний сегмент `Outer$Inner` заменяется. */
function renamed(name: string, simple: string): string {
  const i = name.lastIndexOf('$');
  return i === -1 ? simple : `${name.slice(0, i + 1)}${simple}`;
}

function selectionIs(ref: ClassRef): boolean {
  const sel = useStructureStore.getState().selection;
  return sel !== null && sameRef(sel.ref, ref);
}

export async function saveClass(ref: ClassRef, edit: ClassHeaderEdit): Promise<boolean> {
  const out = await saveFileEdit(ref.path, inClass(ref, (text, cls) => editClassHeader(text, cls, edit)));
  if (out.ok && selectionIs(ref)) {
    selectStructure({ kind: 'class', ref: { path: ref.path, name: renamed(ref.name, edit.name.trim()) } });
  }
  return out.ok;
}

export async function saveField(ref: ClassRef, fieldName: string, edit: FieldEdit): Promise<boolean> {
  const out = await saveFileEdit(
    ref.path,
    inClass(ref, (text, cls) => {
      const field = cls.fields.find((f) => f.name === fieldName);
      return field ? editField(text, cls, field, edit) : { ok: false, reason: NOT_FOUND };
    }),
  );
  if (out.ok && selectionIs(ref)) selectStructure({ kind: 'field', ref, field: edit.name.trim() });
  return out.ok;
}

/** Метод с тем же началом заголовка в новом дереве (замена заголовка его не сдвигает) — новый id после переименования. */
function sameDeclaration(tree: Tree, ref: ClassRef, old: MethodNode): MethodNode | null {
  const found = findClass(tree, ref);
  const line = old.headerStart?.line;
  if (!found || line === undefined) return null;
  return [...found.cls.constructors, ...found.cls.methods].find((m) => m.headerStart?.line === line) ?? null;
}

export async function saveMethod(ref: ClassRef, methodId: string, edit: MethodHeaderEdit): Promise<boolean> {
  const seen: { old: MethodNode | null } = { old: null };
  const out = await saveFileEdit(ref.path, (text, tree) => {
    const old = findMethod(tree, methodId)?.method ?? null;
    seen.old = old;
    return old ? editMethodHeader(text, old, edit) : { ok: false, reason: NOT_FOUND };
  });
  if (out.ok && seen.old) {
    const next = sameDeclaration(out.result.tree, ref, seen.old);
    const app = useAppStore.getState();
    if (next && next.id !== methodId && app.selectedMethodId === methodId) app.selectMethod(next.id);
  }
  return out.ok;
}

/** Шаблон члена по виду; конструктор у interface/record — null. */
function templateFor(kind: MemberKind, cls: ClassNode, type: string, name: string) {
  if (kind === 'field') return fieldTemplate(cls.kind, type, name);
  if (kind === 'method') return methodTemplate(cls.kind, type, name);
  return constructorTemplate(cls.kind, cls.name);
}

/** Новый член класса. `type` — тип поля / тип результата метода; у конструктора не нужен. */
export async function createMember(ref: ClassRef, kind: MemberKind, type: string, name: string): Promise<boolean> {
  let before = new Set<string>();
  const out = await saveFileEdit(
    ref.path,
    inClass(ref, (text, cls) => {
      before = new Set([...cls.constructors, ...cls.methods].map((m) => m.id));
      const template = templateFor(kind, cls, type.trim(), name.trim());
      if (!template) return { ok: false, reason: `У ${cls.kind} нельзя добавить конструктор без параметров` };
      return insertMember(text, cls, kind, template);
    }),
  );
  if (!out.ok) return false;
  if (kind === 'field') {
    selectStructure({ kind: 'field', ref, field: name.trim() });
  } else {
    const cls = findClass(out.result.tree, ref)?.cls;
    const added = cls && [...cls.constructors, ...cls.methods].find((m) => !before.has(m.id));
    if (added) useAppStore.getState().selectMethod(added.id);
  }
  return true;
}

export async function deleteDeclaration(target: DeleteTarget): Promise<boolean> {
  const out = await saveFileEdit(
    target.ref.path,
    inClass(target.ref, (text, cls) => {
      if (target.kind === 'class') return deleteClass(text, cls);
      if (target.kind === 'field') {
        const field = cls.fields.find((f) => f.name === target.field);
        return field ? deleteField(text, cls, field) : { ok: false, reason: NOT_FOUND };
      }
      const method = [...cls.constructors, ...cls.methods].find((m) => m.id === target.methodId);
      return method ? deleteMethod(text, method) : { ok: false, reason: NOT_FOUND };
    }),
  );
  if (!out.ok) return false;
  const app = useAppStore.getState();
  if (target.kind === 'method' && app.selectedMethodId === target.methodId) app.selectMethod(null);
  if (target.kind === 'class' && app.selectedMethodId && !findMethod(out.result.tree, app.selectedMethodId)) {
    app.selectMethod(null);
  }
  const sel = useStructureStore.getState().selection;
  const fieldGone = target.kind === 'field' && sel?.kind === 'field' && sel.field === target.field;
  if (sel && sameRef(sel.ref, target.ref) && (target.kind === 'class' || fieldGone)) {
    selectStructure(target.kind === 'field' ? { kind: 'class', ref: target.ref } : null);
  }
  return true;
}

/** Новый класс верхнего уровня (непубличный) в конце файла `path` — отдельный файл PUT files не создаёт. */
export async function createClass(path: string, kind: ClassKeyword, name: string): Promise<boolean> {
  const out = await saveFileEdit(path, (text) => ({ ok: true, text: appendClass(text, kind, name.trim()) }));
  if (out.ok) selectStructure({ kind: 'class', ref: { path, name: name.trim() } });
  return out.ok;
}
