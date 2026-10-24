/**
 * Низкоуровневые операции над текстом Java-файла для форм структуры (FE-10): позиции, строки,
 * пропуск строк/комментариев, парные скобки, курсор для разбора заголовков. Без React и API.
 */

/** Точка в тексте: line и column с 1, column в UTF-16 code units (TextPosition контракта, как в Monaco). */
export interface TextPos {
  line: number;
  column: number;
}

/** Перевод строки файла: CRLF, если он есть в тексте, иначе LF. */
export function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Смещения начала каждой строки (строка N — индекс N-1). Разделитель — `\n` (при CRLF `\r` остаётся в конце строки). */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/** Конец строки с началом `start` без перевода строки (`\r\n` / `\n`). */
export function lineEnd(text: string, start: number): number {
  const nl = text.indexOf('\n', start);
  if (nl === -1) return text.length;
  return nl > start && text[nl - 1] === '\r' ? nl - 1 : nl;
}

/** Начало следующей строки (после `\n`) или конец текста. */
export function nextLineStart(text: string, from: number): number {
  const nl = text.indexOf('\n', from);
  return nl === -1 ? text.length : nl + 1;
}

/** Начало строки, в которой лежит `offset`. */
export function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/** Смещение позиции в тексте; позиция вне текста или за концом строки — null. */
export function offsetAt(text: string, pos: TextPos, starts = lineStarts(text)): number | null {
  if (pos.line < 1 || pos.line > starts.length || pos.column < 1) return null;
  const start = starts[pos.line - 1] ?? 0;
  const offset = start + pos.column - 1;
  return offset <= lineEnd(text, start) ? offset : null;
}

/** Смещение начала строки `line` (с 1); нет такой строки — null. */
export function lineOffset(text: string, line: number, starts = lineStarts(text)): number | null {
  return line >= 1 && line <= starts.length ? (starts[line - 1] ?? null) : null;
}

/** Ведущие пробелы/табы строки, в которой лежит `offset`. */
export function indentAt(text: string, offset: number): string {
  const start = lineStartOf(text, offset);
  return /^[ \t]*/.exec(text.slice(start, lineEnd(text, start)))?.[0] ?? '';
}

/** Единица отступа файла: таб, если хоть одна строка начинается с таба, иначе 4 пробела. */
export function indentUnit(text: string): string {
  return /(^|\n)\t/.test(text) ? '\t' : '    ';
}

/**
 * Если в `i` начинается строковый/символьный литерал, текстовый блок или комментарий — смещение сразу за ним,
 * иначе `i`. Незакрытый литерал/комментарий тянется до конца строки/текста.
 */
export function skipLiteralOrComment(s: string, i: number): number {
  const c = s[i];
  if (c === '/' && s[i + 1] === '/') {
    const nl = s.indexOf('\n', i);
    return nl === -1 ? s.length : nl;
  }
  if (c === '/' && s[i + 1] === '*') {
    const end = s.indexOf('*/', i + 2);
    return end === -1 ? s.length : end + 2;
  }
  if (c === '"' && s.startsWith('"""', i)) {
    for (let j = i + 3; j < s.length; j++) {
      if (s[j] === '\\') j++;
      else if (s.startsWith('"""', j)) return j + 3;
    }
    return s.length;
  }
  if (c === '"' || c === "'") {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\') j++;
      else if (s[j] === c || s[j] === '\n') return j + 1;
    }
    return s.length;
  }
  return i;
}

/** Есть ли в фрагменте комментарий вне литералов. */
export function hasComment(s: string): boolean {
  for (let i = 0; i < s.length; ) {
    if (s[i] === '/' && (s[i + 1] === '/' || s[i + 1] === '*')) return true;
    const j = skipLiteralOrComment(s, i);
    i = j > i ? j : i + 1;
  }
  return false;
}

/**
 * Обойти символы кода в [from, to): литералы и комментарии пропускаются; `depth` — вложенность (), [], {}
 * относительно `from` на момент символа. `visit` вернул true — остановиться и вернуть индекс.
 */
export function scanCode(
  s: string,
  from: number,
  to: number,
  visit: (i: number, ch: string, depth: number) => boolean | undefined,
): number | null {
  let depth = 0;
  for (let i = from; i < to; ) {
    const j = skipLiteralOrComment(s, i);
    if (j > i) {
      i = j;
      continue;
    }
    const ch = s[i] ?? '';
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (visit(i, ch, depth)) return i;
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    i++;
  }
  return null;
}

/** Парная `}` к `{` в `open` (литералы и комментарии пропускаются); нет — null. */
export function matchBrace(s: string, open: number): number | null {
  if (s[open] !== '{') return null;
  return scanCode(s, open + 1, s.length, (_i, ch, depth) => ch === '}' && depth === -1);
}

const IDENT = /[\p{ID_Start}_$][\p{ID_Continue}$‌‍]*/uy;
const JAVA_IDENT = /^[\p{ID_Start}_$][\p{ID_Continue}$‌‍]*$/u;
const RESERVED = new Set(
  (
    'abstract assert boolean break byte case catch char class const continue default do double else enum extends ' +
    'final finally float for goto if implements import instanceof int interface long native new package private ' +
    'protected public return short static strictfp super switch synchronized this throw throws transient try void ' +
    'volatile while true false null _'
  ).split(' '),
);

/** Допустимое имя Java (не ключевое слово). */
export function isJavaIdentifier(name: string): boolean {
  return JAVA_IDENT.test(name) && !RESERVED.has(name);
}

/** Курсор для разбора заголовков объявлений: пропуск пробелов и комментариев, идентификаторы, парные скобки. */
export class Cursor {
  constructor(
    readonly s: string,
    public i = 0,
  ) {}

  get done(): boolean {
    return this.i >= this.s.length;
  }

  peek(): string {
    return this.s[this.i] ?? '';
  }

  at(str: string): boolean {
    return this.s.startsWith(str, this.i);
  }

  /** Пропустить пробелы и комментарии. */
  ws(): this {
    for (;;) {
      while (/\s/.test(this.peek())) this.i++;
      if (this.at('//') || this.at('/*')) this.i = skipLiteralOrComment(this.s, this.i);
      else return this;
    }
  }

  ident(): string | null {
    IDENT.lastIndex = this.i;
    const m = IDENT.exec(this.s);
    if (!m) return null;
    this.i += m[0].length;
    return m[0];
  }

  /** Идентификатор в текущей позиции, без сдвига. */
  peekIdent(): string | null {
    const at = this.i;
    const id = this.ident();
    this.i = at;
    return id;
  }

  /** Скобочная группа от текущего `open` до парной `close` включительно (литералы пропускаются); нет пары — null. */
  balanced(open: string, close: string): string | null {
    if (this.peek() !== open) return null;
    const start = this.i;
    let depth = 0;
    while (this.i < this.s.length) {
      const j = skipLiteralOrComment(this.s, this.i);
      if (j > this.i) {
        this.i = j;
        continue;
      }
      const ch = this.s[this.i];
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        this.i++;
        return this.s.slice(start, this.i);
      }
      this.i++;
    }
    this.i = start;
    return null;
  }

  /** Аннотация `@Name(...)` (не `@interface`); нет — null без сдвига. */
  annotation(): string | null {
    if (this.peek() !== '@' || /^@\s*interface\b/.test(this.s.slice(this.i))) return null;
    const start = this.i;
    this.i++;
    this.ws();
    if (!this.qualifiedName()) {
      this.i = start;
      return null;
    }
    const afterName = this.i;
    this.ws();
    if (this.peek() === '(') {
      if (this.balanced('(', ')') === null) {
        this.i = start;
        return null;
      }
    } else this.i = afterName;
    return this.s.slice(start, this.i);
  }

  /** `a.b.c`; нет — null. */
  qualifiedName(): string | null {
    const start = this.i;
    if (!this.ident()) return null;
    for (;;) {
      const at = this.i;
      this.ws();
      if (this.peek() !== '.' || this.at('...')) {
        this.i = at;
        break;
      }
      this.i++;
      this.ws();
      if (!this.ident()) {
        this.i = at;
        break;
      }
    }
    return this.s.slice(start, this.i);
  }

  /**
   * Тип: `a.b.C<...>.D<...>[][]...` (примитивы — тоже идентификаторы); нет — null без сдвига.
   * Аннотации внутри типа не поддерживаются.
   */
  type(): string | null {
    const start = this.i;
    for (;;) {
      if (!this.ident()) {
        this.i = start;
        return null;
      }
      let end = this.i;
      this.ws();
      if (this.peek() === '<') {
        if (this.balanced('<', '>') === null) {
          this.i = start;
          return null;
        }
        end = this.i;
      }
      this.ws();
      if (this.peek() === '.' && !this.at('...')) {
        this.i++;
        this.ws();
        continue;
      }
      this.i = end;
      break;
    }
    for (;;) {
      const at = this.i;
      this.ws();
      if (this.peek() === '[') {
        this.i++;
        this.ws();
        if (this.peek() === ']') {
          this.i++;
          continue;
        }
      }
      this.i = at;
      break;
    }
    const at = this.i;
    this.ws();
    if (this.at('...')) this.i += 3;
    else this.i = at;
    return this.s.slice(start, this.i);
  }
}

/** Разбить текст по запятым верхнего уровня (вне (), <>, [], {} и литералов); части обрезаны, пустые отброшены. */
export function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; ) {
    const j = skipLiteralOrComment(s, i);
    if (j > i) {
      i = j;
      continue;
    }
    const ch = s[i];
    if (ch === '(' || ch === '<' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === '>' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/** Тип без пробелов — для сравнения «тот же тип». */
export function normalizeType(t: string): string {
  return t.replace(/\s+/g, '');
}
