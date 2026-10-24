/**
 * Правки текста файла по узлам дерева (FE-10, решение 2026-10-25): замена заголовка по [headerStart, headerEnd),
 * поле — по строкам span, вставка члена перед «}» класса, удаление объявления целиком, новый класс в файле.
 * Чистые функции; всё, что не правится, остаётся байт в байт. Ненадёжный случай — `{ ok: false, reason }`.
 */
import type { Schemas } from '../../api';
import {
  buildClassHeader,
  buildFieldDecl,
  buildMethodHeader,
  parseClassHeader,
  parseFieldDecl,
  parseMethodHeader,
  type ClassHeader,
  type ClassHeaderEdit,
  type ClassKeyword,
  type FieldDecl,
  type FieldEdit,
  type MethodHeader,
  type MethodHeaderEdit,
} from './headers';
import {
  eolOf,
  indentAt,
  indentUnit,
  lineEnd,
  lineOffset,
  lineStartOf,
  lineStarts,
  matchBrace,
  nextLineStart,
  offsetAt,
  scanCode,
  type TextPos,
} from './javaText';

type ClassNode = Schemas['ClassNode'];
type MethodNode = Schemas['MethodNode'];
export type FieldNode = ClassNode['fields'][number];

export type EditResult = { ok: true; text: string } | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const STALE = 'Текст файла не совпадает с деревом проекта — дерево перезагружено, повторите';

interface HeaderRange {
  start: number;
  end: number;
  /** Текст заголовка без хвостовых пробелов. */
  core: string;
  /** Пробелы между заголовком и «{»/«;» — сохраняются. */
  trailing: string;
}

/** Диапазон [headerStart, headerEnd): на headerEnd должен стоять один из `ends`. */
function headerRange(
  text: string,
  node: { headerStart?: TextPos; headerEnd?: TextPos },
  ends: string,
): HeaderRange | string {
  if (!node.headerStart || !node.headerEnd) return 'Бэк не прислал границы заголовка (headerStart/headerEnd)';
  const starts = lineStarts(text);
  const start = offsetAt(text, node.headerStart, starts);
  const end = offsetAt(text, node.headerEnd, starts);
  if (start === null || end === null || end <= start || !ends.includes(text[end] ?? '')) return STALE;
  const old = text.slice(start, end);
  const trailing = /\s*$/.exec(old)?.[0] ?? '';
  return { start, end, core: old.slice(0, old.length - trailing.length), trailing };
}

function replaceRange(text: string, r: HeaderRange, header: string): string {
  return text.slice(0, r.start) + header + r.trailing + text.slice(r.end);
}

// ---------- чтение ----------

export function readClassHeader(text: string, cls: ClassNode): ClassHeader | string {
  const r = headerRange(text, cls, '{');
  if (typeof r === 'string') return r;
  const parsed = parseClassHeader(r.core);
  if (!parsed || parsed.name !== simpleName(cls.name)) return 'Не удалось разобрать заголовок класса';
  return parsed;
}

export function readMethodHeader(text: string, method: MethodNode): MethodHeader | string {
  const r = headerRange(text, method, '{;');
  if (typeof r === 'string') return r;
  const parsed = parseMethodHeader(r.core);
  if (!parsed || parsed.name !== method.name) return 'Не удалось разобрать заголовок метода';
  return parsed;
}

interface FieldRange {
  /** Начало первой строки span. */
  start: number;
  /** Конец последней строки span (без перевода строки). */
  end: number;
  decl: FieldDecl;
}

function fieldRange(text: string, cls: ClassNode, field: FieldNode): FieldRange | string {
  const span = field.span;
  if (!span) return 'Бэк не прислал span поля';
  if (cls.fields.some((f) => f !== field && f.span && sameSpan(f.span, span))) {
    return 'Поле объявлено вместе с другими (`int a, b;`) — только чтение';
  }
  const starts = lineStarts(text);
  const start = lineOffset(text, span.startLine, starts);
  const last = lineOffset(text, span.endLine, starts);
  if (start === null || last === null) return STALE;
  const end = lineEnd(text, last);
  const decl = parseFieldDecl(text.slice(start, end), field);
  if (!decl) return 'Объявление поля не удалось надёжно найти в тексте — только чтение';
  return { start, end, decl };
}

export function readFieldDecl(text: string, cls: ClassNode, field: FieldNode): FieldDecl | string {
  const r = fieldRange(text, cls, field);
  return typeof r === 'string' ? r : r.decl;
}

function sameSpan(a: Schemas['Span'], b: Schemas['Span']): boolean {
  return a.startLine === b.startLine && a.endLine === b.endLine;
}

// ---------- правка заголовков ----------

export function editClassHeader(text: string, cls: ClassNode, edit: ClassHeaderEdit): EditResult {
  const r = headerRange(text, cls, '{');
  if (typeof r === 'string') return fail(r);
  const old = parseClassHeader(r.core);
  if (!old || old.name !== simpleName(cls.name)) return fail('Не удалось разобрать заголовок класса');
  return { ok: true, text: replaceRange(text, r, buildClassHeader(old, edit)) };
}

export function editMethodHeader(text: string, method: MethodNode, edit: MethodHeaderEdit): EditResult {
  const r = headerRange(text, method, '{;');
  if (typeof r === 'string') return fail(r);
  const old = parseMethodHeader(r.core);
  if (!old || old.name !== method.name) return fail('Не удалось разобрать заголовок метода');
  return { ok: true, text: replaceRange(text, r, buildMethodHeader(old, edit)) };
}

export function editField(text: string, cls: ClassNode, field: FieldNode, edit: FieldEdit): EditResult {
  const r = fieldRange(text, cls, field);
  if (typeof r === 'string') return fail(r);
  return { ok: true, text: text.slice(0, r.start) + buildFieldDecl(r.decl, edit) + text.slice(r.end) };
}

// ---------- удаление ----------

/** Начало javadoc `/** … *\/`, стоящего прямо над строкой `lineStart` (между ними — только пробелы); нет — lineStart. */
function withJavadoc(text: string, lineStart: number): number {
  const before = text.slice(0, lineStart).trimEnd();
  if (!before.endsWith('*/')) return lineStart;
  const open = before.lastIndexOf('/**');
  if (open === -1 || before.indexOf('*/', open + 2) !== before.length - 2) return lineStart;
  const ls = lineStartOf(text, open);
  return text.slice(ls, open).trim() === '' ? ls : lineStart;
}

/** Вырезать строки объявления [declStart, declEnd) целиком, с javadoc над ним; лишняя пустая строка схлопывается. */
function cutDeclaration(text: string, declStart: number, declEnd: number): EditResult {
  const ls = lineStartOf(text, declStart);
  if (text.slice(ls, declStart).trim() !== '') return fail('Объявление делит строку с другим кодом — удалите его в редакторе кода');
  const tail = text.slice(declEnd, lineEnd(text, declEnd));
  if (!/^\s*(\/\/.*)?$/.test(tail)) return fail('Объявление делит строку с другим кодом — удалите его в редакторе кода');
  const from = withJavadoc(text, ls);
  let to = nextLineStart(text, declEnd);
  const isBlank = (at: number) => at < text.length && text.slice(at, lineEnd(text, at)).trim() === '';
  if (from > 0 && isBlank(to)) {
    const prev = text.slice(lineStartOf(text, from - 1), from).trim();
    if (prev === '' || prev.endsWith('{')) to = nextLineStart(text, to);
  }
  return { ok: true, text: text.slice(0, from) + text.slice(to) };
}

/** Конец объявления с телом `{…}` или `;` в `headerEnd` (смещение за ним). */
function declarationEnd(text: string, headerEnd: number): number | null {
  if (text[headerEnd] === ';') return headerEnd + 1;
  const close = matchBrace(text, headerEnd);
  return close === null ? null : close + 1;
}

export function deleteMethod(text: string, method: MethodNode): EditResult {
  const r = headerRange(text, method, '{;');
  if (typeof r === 'string') return fail(r);
  const end = declarationEnd(text, r.end);
  if (end === null) return fail(STALE);
  return cutDeclaration(text, r.start, end);
}

export function deleteClass(text: string, cls: ClassNode): EditResult {
  const r = headerRange(text, cls, '{');
  if (typeof r === 'string') return fail(r);
  const end = declarationEnd(text, r.end);
  if (end === null) return fail(STALE);
  return cutDeclaration(text, r.start, end);
}

export function deleteField(text: string, cls: ClassNode, field: FieldNode): EditResult {
  const r = fieldRange(text, cls, field);
  if (typeof r === 'string') return fail(r);
  return cutDeclaration(text, r.start + r.decl.indent.length, r.end);
}

// ---------- вставка ----------

export type MemberKind = 'field' | 'constructor' | 'method';

/** Строки шаблона члена; вложенные строки начинаются с `unit` (единица отступа файла). */
export type Template = (unit: string) => string[];

/** Значение по умолчанию для `return`/инициализатора; `void` — null. */
export function defaultValue(type: string): string | null {
  const t = type.trim();
  if (t === 'void') return null;
  if (t === 'boolean') return 'false';
  if (['byte', 'short', 'int', 'long', 'char', 'float', 'double'].includes(t)) return '0';
  return 'null';
}

/** Простое имя класса: `Outer$Inner` → `Inner`. */
export function simpleName(name: string): string {
  return name.slice(name.lastIndexOf('$') + 1);
}

export function fieldTemplate(kind: ClassKeyword, type: string, name: string): Template {
  if (kind === 'interface') return () => [`${type} ${name} = ${defaultValue(type) ?? 'null'};`];
  // У record поля экземпляра запрещены — только static.
  if (kind === 'record') return () => [`private static ${type} ${name};`];
  return () => [`private ${type} ${name};`];
}

export function methodTemplate(kind: ClassKeyword, returnType: string, name: string): Template {
  if (kind === 'interface') return () => [`${returnType} ${name}();`];
  const value = defaultValue(returnType);
  return (unit) => [`public ${returnType} ${name}() {`, ...(value === null ? [] : [`${unit}return ${value};`]), '}'];
}

/** Конструктор без параметров; у interface и record (нужен вызов this(...)) — null. */
export function constructorTemplate(kind: ClassKeyword, className: string): Template | null {
  if (kind === 'interface' || kind === 'record') return null;
  const visibility = kind === 'enum' ? 'private' : 'public';
  return () => [`${visibility} ${simpleName(className)}() {`, '}'];
}

/** Вставить член в класс: поле — после последнего поля, остальное — перед закрывающей «}», с отступом соседей. */
export function insertMember(text: string, cls: ClassNode, kind: MemberKind, template: Template): EditResult {
  const r = headerRange(text, cls, '{');
  if (typeof r === 'string') return fail(r);
  const open = r.end;
  const close = matchBrace(text, open);
  if (close === null) return fail(STALE);
  const eol = eolOf(text);
  const unit = indentUnit(text);
  const classIndent = indentAt(text, r.start);
  const memberIndent = membersIndent(text, cls, open, close) ?? classIndent + unit;
  const body = template(unit)
    .map((l) => memberIndent + l)
    .join(eol);

  let at: number;
  let insertion: string;
  const closeLine = lineStartOf(text, close);
  const afterField = kind === 'field' ? lastFieldLineEnd(text, cls, open, closeLine) : null;
  if (afterField !== null) {
    at = afterField;
    insertion = body + eol;
  } else if (text.slice(closeLine, close).trim() === '') {
    const prev = text.slice(lineStartOf(text, Math.max(closeLine - 1, 0)), closeLine).trim();
    at = closeLine;
    insertion = (prev === '' || prev.endsWith('{') ? '' : eol) + body + eol;
  } else {
    at = close;
    insertion = eol + body + eol + classIndent;
  }
  let out = text.slice(0, at) + insertion + text.slice(at);

  // enum без «;» после констант: член нельзя ставить сразу за ними.
  if (cls.kind === 'enum') {
    let hasSemi = false;
    let lastCode = open;
    scanCode(text, open + 1, close, (i, ch, depth) => {
      if (depth === 0 && ch === ';') hasSemi = true;
      if (!/\s/.test(ch)) lastCode = i;
      return false;
    });
    if (!hasSemi) out = out.slice(0, lastCode + 1) + ';' + out.slice(lastCode + 1);
  }
  return { ok: true, text: out };
}

/** Отступ существующих членов (первый, стоящий на своей строке внутри тела). */
function membersIndent(text: string, cls: ClassNode, open: number, close: number): string | null {
  const spans = [...cls.fields.map((f) => f.span), ...cls.constructors.map((m) => m.span), ...cls.methods.map((m) => m.span)];
  const openLine = lineStartOf(text, open);
  const closeLine = lineStartOf(text, close);
  for (const span of spans) {
    if (!span) continue;
    const ls = lineOffset(text, span.startLine);
    if (ls === null || ls <= openLine || ls >= closeLine) continue;
    const line = text.slice(ls, lineEnd(text, ls));
    if (line.trim() !== '') return /^[ \t]*/.exec(line)?.[0] ?? '';
  }
  return null;
}

/** Начало строки после последнего поля, если поля стоят на своих строках внутри тела; иначе null. */
function lastFieldLineEnd(text: string, cls: ClassNode, open: number, closeLine: number): number | null {
  const lines = cls.fields.flatMap((f) => (f.span ? [f.span.endLine] : []));
  if (lines.length === 0) return null;
  const ls = lineOffset(text, Math.max(...lines));
  if (ls === null || ls <= lineStartOf(text, open) || ls >= closeLine) return null;
  return nextLineStart(text, ls);
}

// ---------- новый класс ----------

/** Объявление нового класса по kind: record — без компонент, `()`. */
export function classTemplate(kind: ClassKeyword, name: string): string[] {
  return [`${kind} ${name}${kind === 'record' ? '()' : ''} {`, '}'];
}

/**
 * Новый непубличный класс верхнего уровня в конце файла (отдельный файл PUT files создать не может — 404).
 * Существующий текст не меняется: дописывается пустая строка и объявление.
 */
export function appendClass(text: string, kind: ClassKeyword, name: string): string {
  const eol = eolOf(text);
  const base = text === '' || text.endsWith('\n') ? text : text + eol;
  return base + (base.trim() === '' ? '' : eol) + classTemplate(kind, name).join(eol) + eol;
}
