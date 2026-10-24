import type { Schemas } from '../../api';

type Tree = Schemas['ProjectTree'];
type ClassNode = Schemas['ClassNode'];
type MethodNode = Schemas['MethodNode'];

/** Класс в дереве: файл + ClassNode.name (вложенный — Outer$Inner); уникален в проекте. */
export interface ClassRef {
  path: string;
  name: string;
}

export interface FoundClass {
  cls: ClassNode;
  path: string;
  /** Имя пакета ('' — по умолчанию). */
  pkg: string;
}

export function sameRef(a: ClassRef, b: ClassRef): boolean {
  return a.path === b.path && a.name === b.name;
}

function* classes(tree: Tree): Generator<FoundClass> {
  for (const pkg of tree.packages) {
    for (const file of pkg.files) {
      for (const cls of file.classes) yield { cls, path: file.path, pkg: pkg.name };
    }
  }
}

export function findClass(tree: Tree, ref: ClassRef): FoundClass | null {
  for (const c of classes(tree)) if (c.path === ref.path && c.cls.name === ref.name) return c;
  return null;
}

/** FQN класса (`pkg.Outer.Inner`, = UmlClass.id); без `fqn` в дереве (старый бэк) — из пакета и имени. */
export function fqnOf(c: FoundClass): string {
  return c.cls.fqn ?? (c.pkg ? `${c.pkg}.` : '') + c.cls.name.replace(/\$/g, '.');
}

/** По FQN (`pkg.Outer.Inner`, = UmlClass.id); без `fqn` в дереве (старый бэк) — по пакету и имени. */
export function findClassByFqn(tree: Tree, fqn: string): FoundClass | null {
  for (const c of classes(tree)) if (fqnOf(c) === fqn) return c;
  return null;
}

export interface FoundMethod extends FoundClass {
  method: MethodNode;
  isConstructor: boolean;
}

export function findMethod(tree: Tree, methodId: string): FoundMethod | null {
  for (const c of classes(tree)) {
    const ctor = c.cls.constructors.find((m) => m.id === methodId);
    if (ctor) return { ...c, method: ctor, isConstructor: true };
    const method = c.cls.methods.find((m) => m.id === methodId);
    if (method) return { ...c, method, isConstructor: false };
  }
  return null;
}

/** Первый файл пакета (для нового класса); нет — null. */
export function firstFileOf(tree: Tree, pkg: string): string | null {
  return tree.packages.find((p) => p.name === pkg)?.files[0]?.path ?? null;
}
