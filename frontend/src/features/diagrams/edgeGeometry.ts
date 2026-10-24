import type { Point } from './diagramLayout';

/** Тон ребра: обычное, связь наведённого класса, приглушённое, в цикле зависимостей (красное). */
export type EdgeTone = 'base' | 'active' | 'dim' | 'cycle';

export type EndMarker = 'triangle' | 'arrow' | null;
export type StartMarker = 'diamond' | 'diamondFilled' | null;

export const MARKER_COLOR: Record<'base' | 'active' | 'cycle', string> = {
  base: 'var(--jb-dg-wire)',
  active: 'var(--jb-accent)',
  cycle: 'var(--jb-severity-high)',
};

/** id SVG-маркера: форма + тон (у приглушённого — обычный маркер, прозрачность у всего ребра). */
export function markerId(shape: string, tone: EdgeTone): string {
  return `jb-dg-${shape}-${tone === 'dim' ? 'base' : tone}`;
}

/** Путь ломаной. */
export function polylinePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/** Середина ломаной по длине. */
export function polylineMid(points: readonly Point[]): Point {
  const segments = points.slice(1).map((b, i) => {
    const a = points[i] ?? b;
    return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
  });
  let rest = segments.reduce((n, s) => n + s.len, 0) / 2;
  for (const { a, b, len } of segments) {
    if (rest <= len && len > 0) return { x: a.x + ((b.x - a.x) * rest) / len, y: a.y + ((b.y - a.y) * rest) / len };
    rest -= len;
  }
  return points[points.length - 1] ?? { x: 0, y: 0 };
}

/** Точка у конца ломаной: `back` назад по последнему отрезку и `side` вбок (для подписи кратности). */
export function nearEnd(points: readonly Point[], back = 20, side = 10): Point {
  const end = points[points.length - 1] ?? { x: 0, y: 0 };
  const prev = points[points.length - 2] ?? end;
  const len = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
  const dx = (end.x - prev.x) / len;
  const dy = (end.y - prev.y) / len;
  return { x: end.x - dx * back - dy * side, y: end.y - dy * back + dx * side };
}
