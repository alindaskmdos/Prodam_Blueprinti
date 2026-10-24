/** Сообщение парсера (JavaParser) в человекочитаемый вид для красной ноды. */
export interface ParseErrorText {
  /** Что показать под кодом. */
  text: string;
  /** Длинный список ожидаемого — только в подсказку (title). */
  details?: string;
}

const PREFIX = 'Синтаксическая ошибка: ';

/**
 * «Синтаксическая ошибка: Parse error. Found "-", expected one of "%=" "&=" …» →
 * «Синтаксическая ошибка: неожиданный «-» (строка 1, позиция 8).». Позиция — если она есть в сообщении
 * («(line 1,col 8)»). Непонятный формат возвращается как есть.
 */
export function explainParseError(message: string): ParseErrorText {
  const found = /Found\s+(?:"((?:[^"\\]|\\.)*)"|<(\w+)>)/.exec(message);
  if (!found) return { text: message };
  const token = found[1] ?? (found[2] === 'EOF' ? null : found[2]);
  const pos = /line\s+(\d+),\s*col(?:umn)?\s+(\d+)/i.exec(message);
  const where = pos ? ` (строка ${pos[1]}, позиция ${pos[2]})` : '';
  const what = token === null ? 'неожиданный конец текста' : `неожиданный «${token}»`;
  const expected = /expected one of\s+([\s\S]*)$/.exec(message)?.[1]?.trim();
  return { text: `${PREFIX}${what}${where}.`, ...(expected ? { details: `Ожидалось: ${expected}` } : {}) };
}
