import type { Node } from '@xyflow/react';

/** Наименьший масштаб, при котором текст нод ещё читается; ниже — открываем верх схемы, а не весь метод (FE-34). */
export const MIN_READABLE_ZOOM = 0.5;
/** Отступ fitView React Flow (padding 0.1): схема занимает size / (1 + padding), поля делятся поровну по сторонам. */
export const FIT_PADDING = 0.1;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type InitialView = { mode: 'fit' } | { mode: 'top'; viewport: { x: number; y: number; zoom: number } };

type BoundsNode = Pick<Node, 'id' | 'parentId' | 'position' | 'width' | 'height'>;

/** Границы схемы в абсолютных координатах (позиции нод в группах заданы относительно родителя). */
export function graphBounds(nodes: readonly BoundsNode[]): Rect | null {
  if (nodes.length === 0) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const abs = (n: BoundsNode): { x: number; y: number } => {
    let x = n.position.x;
    let y = n.position.y;
    let p = n.parentId ? byId.get(n.parentId) : undefined;
    for (let guard = 0; p && guard < 100; guard++) {
      x += p.position.x;
      y += p.position.y;
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return { x, y };
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const { x, y } = abs(n);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + (n.width ?? 0));
    maxY = Math.max(maxY, y + (n.height ?? 0));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Начальный вид схемы при первом открытии метода. Если fitView всего метода даст масштаб ниже порога
 * читаемости (высокая схема switch на десятки case), показывается верх схемы в читаемом масштабе: по ширине
 * вписывается (но не мельче порога и не крупнее 1), при нехватке ширины прижимается к левому краю (нода метода),
 * иначе центрируется. Размер холста неизвестен или схема пуста — обычный fitView.
 */
export function computeInitialView(bounds: Rect | null, size: Size | null, minZoom = MIN_READABLE_ZOOM): InitialView {
  if (!bounds || !size || size.width <= 0 || size.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return { mode: 'fit' };
  const availW = size.width / (1 + FIT_PADDING);
  const availH = size.height / (1 + FIT_PADDING);
  const widthZoom = availW / bounds.width;
  const fitZoom = Math.min(widthZoom, availH / bounds.height);
  if (fitZoom >= minZoom) return { mode: 'fit' };
  const zoom = Math.min(1, Math.max(minZoom, widthZoom));
  const margin = (size.width - availW) / 2;
  const w = bounds.width * zoom;
  const x = w <= availW ? (size.width - w) / 2 - bounds.x * zoom : margin - bounds.x * zoom;
  const y = (size.height - availH) / 2 - bounds.y * zoom;
  return { mode: 'top', viewport: { x, y, zoom } };
}
