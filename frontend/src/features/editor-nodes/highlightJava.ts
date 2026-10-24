/** Лёгкая подсветка Java для просмотра текста в нодах (без Monaco). */
export type TokenType = 'keyword' | 'string' | 'number' | 'comment' | 'plain';

export interface Token {
  type: TokenType;
  text: string;
}

const KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue',
  'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'if', 'implements',
  'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected',
  'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw',
  'throws', 'transient', 'try', 'void', 'volatile', 'while', 'var', 'record', 'yield', 'sealed', 'permits',
  'true', 'false', 'null',
]);

// Порядок альтернатив важен: комментарии и строки раньше идентификаторов.
const TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b\d[\d_]*(?:\.\d+)?[lLfFdD]?\b)|([A-Za-z_$][\w$]*)/g;

/** Разбивает текст на токены; конкатенация token.text всегда равна исходному тексту. */
export function highlightJava(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  const push = (type: TokenType, t: string) => {
    if (!t) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.type === type && type === 'plain') prev.text += t;
    else tokens.push({ type, text: t });
  };
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    push('plain', text.slice(last, idx));
    const [whole, comment, str, num, ident] = m;
    if (comment) push('comment', whole);
    else if (str) push('string', whole);
    else if (num) push('number', whole);
    else if (ident) push(KEYWORDS.has(ident) ? 'keyword' : 'plain', whole);
    last = idx + whole.length;
  }
  push('plain', text.slice(last));
  return tokens;
}
