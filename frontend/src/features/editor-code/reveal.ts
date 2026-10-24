/** Подсветить строки в редакторе и прокрутить к ним (FE-05); seq — новое событие. */
export interface RevealLines {
  startLine: number;
  endLine: number;
  seq: number;
}

interface FileLines {
  file: string;
  startLine: number;
  endLine: number;
}

/** Событие подсветки (`Highlight` из app/store) — структурно, без зависимости от стора. */
interface HighlightLike {
  source: 'canvas' | 'code' | 'issue';
  span: FileLines | null;
  seq: number;
}

/**
 * Какие строки подсветить в редакторе файла `path`: клик по ноде (`canvas`) — span блока, выбор проблемы
 * (`issue`) — span проблемы (`issueSpan`). Событие самого редактора (`code`) и чужой файл — null:
 * редактор не отвечает на свой же курсор, поэтому цикла «курсор → подсветка → курсор» нет.
 */
export function revealFor(
  highlight: HighlightLike | null,
  path: string,
  issueSpan: FileLines | null = null,
): RevealLines | null {
  if (!highlight || highlight.source === 'code') return null;
  const span = highlight.source === 'canvas' ? highlight.span : issueSpan;
  if (!span || span.file !== path) return null;
  return { startLine: span.startLine, endLine: span.endLine, seq: highlight.seq };
}
