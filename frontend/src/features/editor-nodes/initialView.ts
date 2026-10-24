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

/** Поля холста, занятые оверлеями (панель сверху, мини-карта): схема и цель полёта не должны уходить под них. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
/** Высота верхней панели (кнопка палитры, вид) с отступом: нода метода начинается ниже. */
export const TOP_BAR_INSET = 52;
/** Мини-карта (когда показана) в правом нижнем углу. */
export const MINIMAP_INSET = { right: 160, bottom: 110 };

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
export function computeInitialView(
  bounds: Rect | null,
  size: Size | null,
  minZoom = MIN_READABLE_ZOOM,
  insets: Insets = NO_INSETS,
): InitialView {
  if (!bounds || !size || size.width <= 0 || size.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return { mode: 'fit' };
  // Свободная область холста без оверлеев.
  const areaW = size.width - insets.left - insets.right;
  const areaH = size.height - insets.top - insets.bottom;
  if (areaW <= 0 || areaH <= 0) return { mode: 'fit' };
  const availW = areaW / (1 + FIT_PADDING);
  const availH = areaH / (1 + FIT_PADDING);
  const widthZoom = availW / bounds.width;
  const fitZoom = Math.min(widthZoom, availH / bounds.height);
  if (fitZoom >= minZoom) return { mode: 'fit' };
  const zoom = Math.min(1, Math.max(minZoom, widthZoom));
  const margin = insets.left + (areaW - availW) / 2;
  const w = bounds.width * zoom;
  const x = w <= availW ? insets.left + (areaW - w) / 2 - bounds.x * zoom : margin - bounds.x * zoom;
  const y = insets.top + (areaH - availH) / 2 - bounds.y * zoom;
  return { mode: 'top', viewport: { x, y, zoom } };
}
