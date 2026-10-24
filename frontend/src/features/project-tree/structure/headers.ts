/**
 * Разбор и сборка заголовков объявлений Java (класс, метод/конструктор, поле) для форм FE-10.
 * Чистые функции: текст → части → текст. Аннотации, компоненты record, `permits`, хвост метода (`default …`)
 * и инициализатор поля переносятся байт в байт; меняются только части, которые правит форма.
 */
import { Cursor, hasComment, normalizeType, scanCode, splitTopLevel } from './javaText';

export const CLASS_KEYWORDS = ['class', 'interface', 'enum', 'record'] as const;
export type ClassKeyword = (typeof CLASS_KEYWORDS)[number];

const MODIFIERS = new Set([
  'public',
  'protected',
  'private',
  'static',
  'final',
  'abstract',
  'sealed',
  'non-sealed',
  'strictfp',
  'default',
  'synchronized',
  'native',
  'transient',
  'volatile',
]);

/** Аннотации и модификаторы в начале объявления. */
export interface Lead {
  /** Ведущие аннотации текстом как в коде, вместе с пробелами/переводами строк после них. */
  prefix: string;
  /** Аннотации, стоящие между модификаторами (`public @Deprecated static`): при сборке — сразу после prefix. */
  inlineAnnotations: string[];
  modifiers: string[];
  /** В заголовке есть комментарии — при перезаписи они пропадут. */
  hasComments: boolean;
}

function readLead(c: Cursor): Lead {
  c.ws();
  let prefixEnd = 0;
  while (c.annotation() !== null) prefixEnd = c.ws().i;
  const inlineAnnotations: string[] = [];
  const modifiers: string[] = [];
  for (;;) {
    const ann = c.annotation();
    if (ann !== null) {
      inlineAnnotations.push(ann);
      c.ws();
      continue;
    }
    if (c.at('non-sealed')) {
      c.i += 'non-sealed'.length;
      modifiers.push('non-sealed');
      c.ws();
      continue;
    }
    const id = c.peekIdent();
    if (id === null || !MODIFIERS.has(id)) break;
    // `default` у метода интерфейса — модификатор, у annotation-члена после `)` не встречается здесь.
    c.ident();
    modifiers.push(id);
    c.ws();
  }
  return { prefix: c.s.slice(0, prefixEnd), inlineAnnotations, modifiers, hasComments: false };
}

function joinLead(lead: Pick<Lead, 'prefix' | 'inlineAnnotations'>, modifiers: readonly string[], rest: string[]): string {
  const parts = [...lead.inlineAnnotations, ...modifiers, ...rest].filter((p) => p !== '');
  return lead.prefix + parts.join(' ');
}

// ---------- класс ----------

export interface ClassHeader extends Lead {
  keyword: ClassKeyword;
  name: string;
  /** `<A, B>` или ''. */
  typeParams: string;
  /** Компоненты record `(int a, int b)` или ''. */
  components: string;
  /** Текст после extends или ''. */
  extends: string;
  implements: string[];
  /** Текст после permits или ''. */
  permits: string;
}

const CLAUSES = new Set(['extends', 'implements', 'permits']);

/** Текст предложения (extends/implements/permits) до следующего ключевого слова-предложения или конца. */
function readClause(c: Cursor): string {
  const start = c.i;
  let end = c.i;
  while (!c.done) {
    c.ws();
    if (c.done) break;
    const at = c.i;
    const id = c.ident();
    if (id !== null) {
      if (CLAUSES.has(id)) {
        c.i = at;
        break;
      }
    } else if (c.peek() === '<') {
      if (c.balanced('<', '>') === null) c.i++;
    } else c.i++;
    end = c.i;
  }
  return c.s.slice(start, end).trim();
}

/** Разобрать заголовок класса (текст от headerStart до «{» без хвостовых пробелов); не получилось — null. */
export function parseClassHeader(header: string): ClassHeader | null {
  const c = new Cursor(header);
  const lead = readLead(c);
  const keyword = c.ident();
  if (!keyword || !(CLASS_KEYWORDS as readonly string[]).includes(keyword)) return null;
  c.ws();
  const name = c.ident();
  if (!name) return null;
  c.ws();
  const typeParams = c.peek() === '<' ? c.balanced('<', '>') : '';
  if (typeParams === null) return null;
  c.ws();
  let components = '';
  if (keyword === 'record') {
    const comp = c.balanced('(', ')');
    if (comp === null) return null;
    components = comp;
  }
  const result: ClassHeader = {
    ...lead,
    hasComments: hasComment(header),
    keyword: keyword as ClassKeyword,
    name,
    typeParams,
    components,
    extends: '',
    implements: [],
    permits: '',
  };
  for (;;) {
    c.ws();
    if (c.done) break;
    const clause = c.ident();
    if (clause === 'extends') result.extends = readClause(c);
    else if (clause === 'implements') result.implements = splitTopLevel(readClause(c));
    else if (clause === 'permits') result.permits = readClause(c);
    else return null;
  }
  return result;
}

/** Что правит форма класса. */
export interface ClassHeaderEdit {
  modifiers: string[];
  keyword: ClassKeyword;
  name: string;
  typeParams: string;
  extends: string;
  implements: string[];
  /** Компоненты record: неизменённые сохраняются текстом как в коде; не задано — компоненты как были. */
  components?: ParamEdit[];
}

/**
 * Компоненты record из `(…)` заголовка. Тип — всё до последнего идентификатора (с аннотациями и `...`),
 * имя — последний идентификатор; не разобралось — null (форма только для чтения).
 */
export function parseComponents(components: string): ParamText[] | null {
  const out: ParamText[] = [];
  for (const text of splitTopLevel(components.trim().slice(1, -1))) {
    const m = /^([\s\S]*\S)\s+([\p{L}_$][\p{L}\p{N}_$]*)$/u.exec(text);
    if (!m?.[1] || !m[2]) return null;
    out.push({ text, type: m[1], name: m[2] });
  }
  return out;
}

/** Параметры формы → текст: пара (тип, имя), совпавшая с исходной, остаётся текстом как в коде (`final`, аннотации). */
function renderParams(old: readonly ParamText[], edit: readonly ParamEdit[]): string[] {
  const unused = [...old];
  return edit.map((p) => {
    const type = p.type.trim();
    const name = p.name.trim();
    const idx = unused.findIndex((o) => o.name === name && normalizeType(o.type) === normalizeType(type));
    if (idx === -1) return `${type} ${name}`;
    const [original] = unused.splice(idx, 1);
    return original?.text ?? `${type} ${name}`;
  });
}

/** Собрать заголовок класса: части формы + перенесённые аннотации, компоненты record и permits. */
export function buildClassHeader(old: ClassHeader, edit: ClassHeaderEdit): string {
  const typeParams = edit.typeParams.trim();
  let text = joinLead(old, edit.modifiers, [edit.keyword, edit.name.trim() + typeParams]);
  if (edit.keyword === 'record') {
    text += edit.components
      ? `(${renderParams(parseComponents(old.components) ?? [], edit.components).join(', ')})`
      : old.components || '()';
  }
  if (edit.extends.trim()) text += ` extends ${edit.extends.trim()}`;
  const impl = edit.implements.map((t) => t.trim()).filter(Boolean);
  if (impl.length > 0) text += ` implements ${impl.join(', ')}`;
  if (old.permits) text += ` permits ${old.permits}`;
  return text;
}

// ---------- метод / конструктор ----------

export interface ParamText {
  /** Параметр как в коде (с `final`, аннотациями). */
  text: string;
  type: string;
  name: string;
}

export interface MethodHeader extends Lead {
  typeParams: string;
  /** '' у конструктора. */
  returnType: string;
  name: string;
  params: ParamText[];
  throws: string[];
  /** Всё после `)`, если нет throws, напр. ` default 5` у члена аннотации; обычно ''. */
  tail: string;
}

function parseParam(text: string): ParamText | null {
  const c = new Cursor(text);
  c.ws();
  for (;;) {
    if (c.annotation() !== null) c.ws();
    else if (c.peekIdent() === 'final') {
      c.ident();
      c.ws();
    } else break;
  }
  const type = c.type();
  if (type === null) return null;
  c.ws();
  const name = c.ident();
  if (!name) return null;
  return { text, type, name };
}

/** Разобрать заголовок метода/конструктора (от headerStart до «{»/«;» без хвостовых пробелов); не получилось — null. */
export function parseMethodHeader(header: string): MethodHeader | null {
  const c = new Cursor(header);
  const lead = readLead(c);
  const typeParams = c.peek() === '<' ? c.balanced('<', '>') : '';
  if (typeParams === null) return null;
  c.ws();
  let returnType = '';
  const beforeType = c.i;
  const first = c.ident();
  if (!first) return null;
  c.ws();
  let name: string | null = first;
  if (c.peek() !== '(') {
    c.i = beforeType;
    const type = c.type();
    if (type === null) return null;
    returnType = type;
    c.ws();
    name = c.ident();
    if (!name) return null;
    c.ws();
  }
  const paramsText = c.balanced('(', ')');
  if (paramsText === null) return null;
  const params: ParamText[] = [];
  for (const p of splitTopLevel(paramsText.slice(1, -1))) {
    const parsed = parseParam(p);
    if (!parsed) return null;
    params.push(parsed);
  }
  const afterParams = c.i;
  c.ws();
  let throws: string[] = [];
  let tail = header.slice(afterParams);
  if (c.peekIdent() === 'throws') {
    c.ident();
    throws = splitTopLevel(header.slice(c.i));
    tail = '';
  }
  return { ...lead, hasComments: hasComment(header), typeParams, returnType, name, params, throws, tail };
}

/** Параметр формы; `original` — как он был в коде (сохраняется, если тип и имя не менялись). */
export interface ParamEdit {
  type: string;
  name: string;
}

export interface MethodHeaderEdit {
  modifiers: string[];
  typeParams: string;
  /** Игнорируется у конструктора (в старом заголовке нет типа результата). */
  returnType: string;
  name: string;
  params: ParamEdit[];
  throws: string[];
}

/** Собрать заголовок метода: параметры с неизменёнными типом и именем — текстом как в коде (`final`, аннотации). */
export function buildMethodHeader(old: MethodHeader, edit: MethodHeaderEdit): string {
  const params = renderParams(old.params, edit.params);
  const isConstructor = old.returnType === '';
  const rest = [edit.typeParams.trim(), isConstructor ? '' : edit.returnType.trim()];
  const head = joinLead(old, edit.modifiers, [...rest, edit.name.trim()]);
  const throws = edit.throws.map((t) => t.trim()).filter(Boolean);
  return `${head}(${params.join(', ')})${throws.length > 0 ? ` throws ${throws.join(', ')}` : ''}${old.tail}`;
}

// ---------- поле ----------

export interface FieldDecl extends Lead {
  /** Отступ строки перед объявлением. */
  indent: string;
  type: string;
  name: string;
  /** От имени до конца: ` = new ArrayList<>();` и комментарий в конце строки — байт в байт. */
  rest: string;
}

/**
 * Разобрать объявление поля по тексту строк его span. Объявление занимает
 * строки целиком (после «;» — только пробелы или комментарий), тип и имя совпадают с деревом — иначе null.
 */
export function parseFieldDecl(lines: string, expect: { name: string; type: string }): FieldDecl | null {
  const indent = /^[ \t]*/.exec(lines)?.[0] ?? '';
  const body = lines.slice(indent.length);
  const c = new Cursor(body);
  const lead = readLead(c);
  const type = c.type();
  if (type === null) return null;
  c.ws();
  const name = c.ident();
  if (!name || name !== expect.name || normalizeType(type) !== normalizeType(expect.type)) return null;
  const rest = body.slice(c.i);
  if (!/^\s*[=;]/.test(rest)) return null;
  // `int a, b;` здесь не отличить от запятых в `new HashMap<K, V>()` — общий span ловит вызывающий (edits.ts).
  const semi = scanCode(rest, 0, rest.length, (_i, ch, depth) => depth === 0 && ch === ';');
  if (semi === null) return null;
  const after = rest.slice(semi + 1);
  if (!/^\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/)?\s*$/.test(after)) return null;
  return { ...lead, hasComments: hasComment(body.slice(0, c.i)), indent, type, name, rest };
}

export interface FieldEdit {
  modifiers: string[];
  type: string;
  name: string;
}

export function buildFieldDecl(old: FieldDecl, edit: FieldEdit): string {
  return old.indent + joinLead(old, edit.modifiers, [edit.type.trim(), edit.name.trim()]) + old.rest;
}
