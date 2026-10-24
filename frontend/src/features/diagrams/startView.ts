import { useRef, type RefObject } from 'react';
import type { Node, Viewport } from '@xyflow/react';
import { computeInitialView, graphBounds, type InitialView } from '../editor-nodes';

/** Сверху слева — панель поиска (~56 px вместе с отступом): верх диаграммы не должен лежать под ней. */
const TOOLBAR_INSET = 56;

/**
 * Начальный вид диаграммы (как FE-34 у схемы метода): fitView всего графа на 20+ классах даёт нечитаемый масштаб,
 * поэтому при масштабе ниже `minZoom` открывается верх-лево диаграммы в читаемом масштабе (остальное — мини-карта,
 * Fit View, панорама). Решается один раз при первой готовой раскладке; `ref` — на элемент холста (его размер).
 * `viewport` — defaultViewport React Flow; null — обычный `fitView`.
 */
export function useStartView(
  nodes: readonly Pick<Node, 'id' | 'position' | 'width' | 'height'>[] | null,
  minZoom?: number,
): { ref: RefObject<HTMLDivElement>; viewport: Viewport | null } {
  const ref = useRef<HTMLDivElement>(null);
  const decided = useRef<InitialView | null>(null);
  if (nodes && !decided.current) {
    const el = ref.current;
    const size = el && el.clientWidth > 0 ? { width: el.clientWidth, height: el.clientHeight } : null;
    decided.current = computeInitialView(graphBounds(nodes), size, minZoom);
  }
  const view = decided.current;
  const viewport = view?.mode === 'top' && nodes ? anchorOnTop(view.viewport, nodes, ref.current?.clientWidth ?? 0) : null;
  return { ref, viewport };
}

/**
 * Верх-лево рамки графа часто пуст (корень иерархии — например, Main — правее): вид центрируется по горизонтали
 * на самом верхнем узле (при равенстве — левом) и опускается под панель поиска.
 */
export function anchorOnTop(
  viewport: Viewport,
  nodes: readonly Pick<Node, 'position' | 'width'>[],
  canvasWidth: number,
): Viewport {
  let top: Pick<Node, 'position' | 'width'> | undefined;
  for (const n of nodes) {
    if (!top || n.position.y < top.position.y || (n.position.y === top.position.y && n.position.x < top.position.x)) top = n;
  }
  const y = viewport.y + TOOLBAR_INSET;
  if (!top || canvasWidth <= 0) return { ...viewport, y };
  return { ...viewport, x: canvasWidth / 2 - (top.position.x + (top.width ?? 0) / 2) * viewport.zoom, y };
}
