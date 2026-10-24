import type { Block } from './kinds';

type Span = NonNullable<Block['span']>;

function contains(span: Span | undefined, line: number, file?: string): boolean {
  if (!span) return false;
  if (file !== undefined && span.file !== file) return false;
  return span.startLine <= line && line <= span.endLine;
}

/**
 * Самый глубокий блок дерева, чей span содержит строку `line` (строки с 1, границы включительно).
 * `file` задан — блоки из другого файла не подходят. Блок без span пропускается, но его потомки
 * проверяются (у вставленного локально блока span ещё нет). Нет подходящего — null.
 * Среди соседей с пересекающимися span (бывает у однострочных `a; b;`) берётся первый.
 */
export function blockAtLine(root: Block, line: number, file?: string): Block | null {
  let best: Block | null = null;
  const visit = (block: Block, depth: number, bestDepth: { d: number }) => {
    const hit = contains(block.span, line, file);
    if (hit && depth > bestDepth.d) {
      best = block;
      bestDepth.d = depth;
    }
    if (block.span && !hit) return;
    for (const items of Object.values(block.slots ?? {})) {
      for (const child of items) visit(child, depth + 1, bestDepth);
    }
  };
  visit(root, 0, { d: -1 });
  return best;
}

/** Блок по id (Block.id) в дереве; нет — null. */
export function findBlockById(root: Block, id: string): Block | null {
  if (root.id === id) return root;
  for (const items of Object.values(root.slots ?? {})) {
    for (const child of items) {
      const found = findBlockById(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** span блока по id; нет блока или у него нет span — null. */
export function spanOfBlock(root: Block, id: string): Span | null {
  return findBlockById(root, id)?.span ?? null;
}
