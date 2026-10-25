import type { Point } from './diagramLayout';

/** Тон ребра: обычное, связь наведённого класса, приглушённое, слабое (связь «хаба» до наведения), в цикле зависимостей (красное). */
export type EdgeTone = 'base' | 'active' | 'dim' | 'faint' | 'cycle';

export type EndMarker = 'triangle' | 'arrow' | null;
export type StartMarker = 'diamond' | 'diamondFilled' | null;

export const MARKER_COLOR: Record<'base' | 'active' | 'cycle', string> = {
  base: 'var(--jb-dg-wire)',
  active: 'var(--jb-accent)',
  cycle: 'var(--jb-severity-high)',
};

/** id SVG-маркера: форма + тон (у приглушённых — обычный маркер, прозрачность у всего ребра). */
export function markerId(shape: string, tone: EdgeTone): string {
  return `jb-dg-${shape}-${tone === 'dim' || tone === 'faint' ? 'base' : tone}`;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Путь ломаной. */
export function polylinePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
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

/** Подпись с центром `p` и полуразмерами `hw` × `hh` задевает карточку. */
function onBox(p: Point, hw: number, hh: number, boxes: readonly Box[]): boolean {
  return boxes.some((b) => p.x + hw > b.x && p.x - hw < b.x + b.width && p.y + hh > b.y && p.y - hh < b.y + b.height);
}

/** Точка выхода луча из центра `box` в сторону (dx, dy) через его границу. */
function exitPoint(box: Box, dx: number, dy: number): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const tx = dx === 0 ? Infinity : box.width / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : box.height / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Прямая между карточками от границы до границы (по линии центров) — для рёбер вне раскладки ELK
 * (зависимость наведённой карточки при скрытых зависимостях). Карточки пересекаются — null.
 */
export function straightRoute(from: Box, to: Box): Point[] | null {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (dx === 0 && dy === 0) return null;
  const a = exitPoint(from, dx, dy);
  const b = exitPoint(to, -dx, -dy);
  if ((b.x - a.x) * dx + (b.y - a.y) * dy <= 0) return null;
  return [a, b];
}

/** Место кратности у конца ребра: вплотную, затем дальше назад по ребру; на карточки подпись не ложится. */
export function multiplicitySpot(points: readonly Point[], boxes: readonly Box[]): Point | null {
  for (const back of [20, 32, 44]) {
    const p = nearEnd(points, back, 10);
    if (!onBox(p, 8, 9, boxes)) return p;
  }
  return null;
}

/**
 * Петля самосвязи у правой стороны карточки `box`; `slot` — номер петли у карточки (петли разных видов
 * связи идут одна под другой и выступают дальше). Конец ломаной лежит на карточке (там маркер).
 */
export function selfLoopPoints(box: Box, slot = 0): Point[] {
  const out = 28 + slot * 10;
  const top = box.y + 10 + slot * 30;
  const right = box.x + box.width;
  return [
    { x: right, y: top },
    { x: right + out, y: top },
    { x: right + out, y: top + 22 },
    { x: right, y: top + 22 },
  ];
}
